import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "../../config/app-config.js";
import { createDatabase } from "../../lib/database/postgres.js";
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
 * Run the publisher until asked to stop.
 *
 * @returns Nothing, once shutdown completes.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const database = createDatabase(config.database);
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

  while (running) {
    const { reachedEnd } = await publishOutboxBatch({
      pool: database.pool,
      producer,
      batchSize: BATCH_SIZE,
    });

    // Idle only once the queue is drained. A pass that filled its batch has
    // almost certainly left more behind and should go again immediately.
    if (reachedEnd) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
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
