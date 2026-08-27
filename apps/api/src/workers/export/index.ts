// Before anything that declares an entity: TypeORM's decorators register
// themselves through the metadata reflection API, which is a polyfill rather
// than something the runtime provides.
import "reflect-metadata";

import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "../../config/app-config.js";
import { ExportSourceRepository } from "../../features/privacy/export-source.repository.js";
import { ExportRepository } from "../../features/privacy/export.repository.js";
import { createStorageClient } from "../../integrations/storage/storage-client.js";
import { connectDatabase, createDatabase } from "../../lib/database/postgres.js";
import { buildDueExports } from "./build.js";

/**
 * The export worker.
 *
 * Deployed separately for the reason the others are: assembling a history of
 * ten thousand Moments is unbounded work, and a request that started it would
 * time out having written half an export nobody can tell is incomplete.
 *
 * Several instances may run. Requests are claimed with `FOR UPDATE SKIP LOCKED`
 * and leased, so workers take disjoint work and a process that dies mid-build
 * leaves a request that becomes due again rather than one stuck.
 *
 * It also sweeps. A prepared export is the only new copy of somebody's history
 * this system makes, it has an expiry, and something has to enforce one — so
 * the process that creates them is the process that removes them.
 */

/**
 * How often to look for work when there was none.
 *
 * Slower than the erasure worker, because this also sweeps and a sweep that ran
 * every second would be a query a second asking whether three days have passed.
 */
const IDLE_INTERVAL_MS = 15_000;

/** How long to wait after a full batch. Nothing: there is almost certainly more. */
const BUSY_INTERVAL_MS = 0;

const BATCH_SIZE = 5;

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

  let running = true;

  const shutdown = async (): Promise<void> => {
    running = false;
    await database.close();
  };

  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  while (running) {
    const result = await buildDueExports({
      dataSource: database.dataSource,
      exports: new ExportRepository(database.dataSource),
      sources: new ExportSourceRepository(database.dataSource),
      storage,
      batchSize: BATCH_SIZE,
    });

    // Written only when something stopped. Somebody is waiting for an export
    // that will never arrive, which is the one outcome here worth telling an
    // operator about.
    if (result.failed + result.abandoned > 0) {
      process.stderr.write(
        `Exports not prepared: ${result.failed} failed, ${result.abandoned} abandoned\n`,
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
    process.stderr.write(`Export worker failed: ${String(error)}\n`);
  }
  process.exit(1);
}
