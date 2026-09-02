// Before anything that declares an entity: TypeORM's decorators register
// themselves through the metadata reflection API, which is a polyfill rather
// than something the runtime provides.
import "reflect-metadata";

import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "../../config/app-config.js";
import { sweepPublishedOutbox } from "../../lib/database/outbox.js";
import { connectDatabase, createDatabase } from "../../lib/database/postgres.js";
import { createMessaging } from "../../lib/messaging/kafka.js";
import { createEventProducer } from "../../lib/messaging/producer.js";
import { publishOutboxBatch } from "./publish-outbox.js";

/**
 * The outbox-publisher worker.
 *
 * Deployed separately from the HTTP process (ADR-050): publication is a
 * long-running loop whose failure and scaling characteristics have nothing in
 * common with serving requests, and an HTTP process should not be kept alive
 * merely because a publisher is mid-batch.
 *
 * Several instances may run. Batches are claimed with `FOR UPDATE SKIP LOCKED`,
 * so two publishers take disjoint work rather than duplicating each other.
 */

const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 100;

/**
 * How often to sweep published messages.
 *
 * Far less often than the publisher polls. Retention is measured in hours, so
 * checking every minute is already more precise than the policy it enforces,
 * and sweeping on every idle pass would run a delete a second for nothing.
 */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * How many rows one sweep removes at most.
 *
 * Larger than a publish batch because a delete by primary key is cheap, and
 * bounded so a table left unswept for a long time is drained over several
 * passes rather than in one transaction holding locks the publisher needs.
 */
const SWEEP_BATCH_SIZE = 1_000;

/**
 * Run the publisher until asked to stop.
 *
 * @returns Nothing, once shutdown completes.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const database = createDatabase(config.database);
  await connectDatabase(database);
  const messaging = createMessaging(config.messaging);
  const producer = createEventProducer(messaging.kafka);

  await producer.connect();

  let running = true;

  const shutdown = async (): Promise<void> => {
    running = false;
    await producer.disconnect();
    await messaging.close();
    await database.close();
  };

  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  let sweepDueAt = 0;

  while (running) {
    const { reachedEnd } = await publishOutboxBatch({
      dataSource: database.dataSource,
      producer,
      batchSize: BATCH_SIZE,
    });

    // Idle only once the queue is drained. A pass that filled its batch has
    // almost certainly left more behind and should go again immediately.
    if (!reachedEnd) {
      continue;
    }

    // Swept while idle, and never at the expense of publishing: delivery is
    // owed to somebody, housekeeping is not.
    if (Date.now() >= sweepDueAt) {
      const swept = await sweepPublishedOutbox(
        database.dataSource,
        config.outbox.retentionMs,
        SWEEP_BATCH_SIZE,
      );

      // A full batch means there is more to remove, so go again next pass
      // rather than waiting out the interval on a backlog.
      sweepDueAt = swept.reachedEnd ? Date.now() + SWEEP_INTERVAL_MS : 0;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof ConfigurationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`Outbox publisher failed: ${String(error)}\n`);
  }
  process.exit(1);
}
