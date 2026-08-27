// Before anything that declares an entity: TypeORM's decorators register
// themselves through the metadata reflection API, which is a polyfill rather
// than something the runtime provides.
import "reflect-metadata";

import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "../../config/app-config.js";
import { MomentRepository } from "../../features/moments/moment.repository.js";
import { ErasureRepository } from "../../features/privacy/erasure.repository.js";
import { INDEX_VERSION } from "../../features/search/search-document.js";
import { SearchRepository } from "../../features/search/search.repository.js";
import { UploadRepository } from "../../features/uploads/upload.repository.js";
import { UploadService } from "../../features/uploads/upload.service.js";
import { createStorageClient } from "../../integrations/storage/storage-client.js";
import { connectDatabase, createDatabase } from "../../lib/database/postgres.js";
import { eraseDueRequests } from "./erase.js";

/**
 * The erasure worker.
 *
 * Deployed separately from the HTTP process, for the reason every other worker
 * here is: erasing a Moment's media is unbounded object-storage work, and a
 * request that started it would time out half-finished with no record of how
 * far it got.
 *
 * Several instances may run. Requests are claimed with `FOR UPDATE SKIP LOCKED`
 * and leased, so workers take disjoint work and a process that dies mid-erasure
 * leaves a request that becomes due again rather than one stuck.
 *
 * Nothing a person waits on depends on this. Deleting a Moment removes it from
 * every surface synchronously and blanks what it said; this removes what is
 * left. If it is down for an hour, the consequence is that bytes nobody can
 * reach through the product stay in a bucket for an hour longer.
 */

/**
 * How often to look for work when there was none.
 *
 * Erasure is not something anybody is watching a screen for, and the requests
 * it finds were mostly created seconds after somebody pressed delete. Polling
 * every few seconds would be a query a second for nothing most of the time.
 */
const IDLE_INTERVAL_MS = 10_000;

/** How long to wait after a full batch. Nothing: there is almost certainly more. */
const BUSY_INTERVAL_MS = 0;

const BATCH_SIZE = 20;

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
    const result = await eraseDueRequests({
      dataSource: database.dataSource,
      erasures: new ErasureRepository(database.dataSource),
      moments: new MomentRepository(database.dataSource),
      uploads,
      documents: new SearchRepository(database.dataSource),
      indexVersion: INDEX_VERSION,
      batchSize: BATCH_SIZE,
    });

    // Written only when something stopped. An erasure that will be retried is
    // ordinary; one that will not is a deletion somebody has been told happened
    // and which has not, which is the only outcome here worth waking somebody
    // for.
    if (result.failed + result.abandoned > 0) {
      process.stderr.write(
        `Erasures not completed: ${result.failed} failed, ${result.abandoned} abandoned\n`,
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
    process.stderr.write(`Erasure worker failed: ${String(error)}\n`);
  }
  process.exit(1);
}
