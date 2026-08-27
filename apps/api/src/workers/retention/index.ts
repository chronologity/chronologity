// Before anything that declares an entity: TypeORM's decorators register
// themselves through the metadata reflection API, which is a polyfill rather
// than something the runtime provides.
import "reflect-metadata";

import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "../../config/app-config.js";
import { RetentionRepository } from "../../features/privacy/retention.repository.js";
import { UploadRepository } from "../../features/uploads/upload.repository.js";
import { UploadService } from "../../features/uploads/upload.service.js";
import { createStorageClient } from "../../integrations/storage/storage-client.js";
import { connectDatabase, createDatabase } from "../../lib/database/postgres.js";
import { sweepRetained } from "./sweep.js";

/**
 * The retention worker.
 *
 * One process owning every periodic sweep, so that what expires and when is
 * answered by reading one schedule rather than four codebases. It is the only
 * worker here that is driven by a clock rather than by a queue: nothing asked
 * for this work, and nobody is waiting for it.
 *
 * Several instances may run. Every sweep claims its batch with
 * `FOR UPDATE SKIP LOCKED`, so two workers take disjoint rows — and because a
 * sweep keeps no state, a process that dies mid-pass leaves nothing to recover.
 * The next pass simply finds what the last one did not remove.
 */

/**
 * How often to sweep when there was nothing left to do.
 *
 * Slow on purpose. Retention periods are measured in days, so a pass every few
 * minutes is already far more precise than the policy it enforces, and sweeping
 * more often would be a query a minute asking whether a fortnight has gone by.
 */
const IDLE_INTERVAL_MS = 5 * 60 * 1_000;

/** How long to wait when a pass filled a batch. Nothing: there is more to remove. */
const BUSY_INTERVAL_MS = 0;

/**
 * Run the worker until asked to stop.
 *
 * @returns Nothing, once shutdown completes.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const database = createDatabase(config.database);
  await connectDatabase(database);

  const storage = createStorageClient(config.storage);
  const uploads = new UploadService(
    database.dataSource,
    new UploadRepository(database.dataSource),
    storage,
    config.uploadLimits,
    {},
  );

  let running = true;

  const shutdown = async (): Promise<void> => {
    running = false;
    await database.close();
  };

  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  while (running) {
    const result = await sweepRetained({
      retention: new RetentionRepository(database.dataSource),
      uploads,
      periods: config.retention.periods,
    });

    const removed = Object.values(result.swept).reduce((total, count) => total + count, 0);

    // Written when something was removed, which is rare enough to be worth
    // seeing and useful enough to check against the policy. A pass that removed
    // nothing is the ordinary case and says nothing.
    if (removed + result.uploadsErased > 0) {
      process.stdout.write(
        `${JSON.stringify({ swept: result.swept, uploadsErased: result.uploadsErased })}\n`,
      );
    }

    await new Promise((resolve) =>
      setTimeout(resolve, result.reachedEnd ? IDLE_INTERVAL_MS : BUSY_INTERVAL_MS),
    );
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof ConfigurationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`Retention worker failed: ${String(error)}\n`);
  }
  process.exit(1);
}
