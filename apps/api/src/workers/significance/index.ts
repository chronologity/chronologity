// Before anything that declares an entity: TypeORM's decorators register
// themselves through the metadata reflection API, which is a polyfill rather
// than something the runtime provides.
import "reflect-metadata";

import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "../../config/app-config.js";
import { MomentSignificanceRepository } from "../../features/moments/moment-significance.repository.js";
import { connectDatabase, createDatabase } from "../../lib/database/postgres.js";
import { recomputeSignificanceBatch } from "./recompute-significance.js";

/**
 * The significance worker.
 *
 * Deployed separately from the HTTP process, like the outbox publisher: this is
 * a long-running sweep whose failure and scaling characteristics have nothing in
 * common with serving requests.
 *
 * It reassesses Moments stalest-first, forever. Significance is derived from
 * history that keeps arriving — a Moment gaining a descendant may change the
 * reading of history six generations upstream — and
 * `historical-significance.md:206` says plainly that not every such change
 * should trigger a synchronous recalculation.
 *
 * **It cannot see engagement.** Neither this worker nor anything it uses reaches
 * reactions or comments, which is what keeps a future optimisation from quietly
 * turning attention into historical importance.
 */

/**
 * How long to wait after a pass that found less than a full batch.
 *
 * Longer than the outbox publisher's, because nothing is owed to anybody here.
 * Significance is allowed to lag: invariant 45 permits eventual consistency, and
 * nothing reads these values until temporal zoom exists.
 */
const IDLE_INTERVAL_MS = 60_000;

/** How long to wait between full batches, so a sweep does not monopolise the database. */
const BUSY_INTERVAL_MS = 1_000;

const BATCH_SIZE = 100;

/**
 * Run the worker until asked to stop.
 *
 * @returns Nothing, once shutdown completes.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const database = createDatabase(config.database);

  await connectDatabase(database);

  const significance = new MomentSignificanceRepository(database.dataSource);

  let running = true;

  const shutdown = async (): Promise<void> => {
    running = false;
    await database.close();
  };

  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  while (running) {
    const { reachedEnd } = await recomputeSignificanceBatch({
      dataSource: database.dataSource,
      significance,
      batchSize: BATCH_SIZE,
    });

    await new Promise((resolve) =>
      setTimeout(resolve, reachedEnd ? IDLE_INTERVAL_MS : BUSY_INTERVAL_MS),
    );
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof ConfigurationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`Significance worker failed: ${String(error)}\n`);
  }
  process.exit(1);
}
