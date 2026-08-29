// Before anything that declares an entity: TypeORM's decorators register
// themselves through the metadata reflection API, which is a polyfill rather
// than something the runtime provides.
import "reflect-metadata";

import { parseArgs } from "node:util";
import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "../config/app-config.js";
import { TimelineProjector } from "../features/timeline/timeline.projector.js";
import { rebuildTimeline } from "../features/timeline/timeline.rebuild.js";
import { TimelineRepository } from "../features/timeline/timeline.repository.js";
import { TIMELINE_VERSION } from "../features/timeline/timeline-row.js";
import { TimelineSourceRepository } from "../features/timeline/timeline-source.repository.js";
import { createAnalytics } from "../lib/clickhouse/clickhouse.js";
import { connectDatabase, createDatabase } from "../lib/database/postgres.js";

const usage = "Usage: pnpm timeline:rebuild [--version <name>] [--only <momentId>]...";

/**
 * Rebuild the Timeline projection from authoritative state.
 *
 *     pnpm timeline:rebuild --version <name>
 *     pnpm timeline:rebuild
 *     pnpm timeline:rebuild --only <momentId> --only <momentId>
 *
 * With no argument it walks every Moment in occurrence order and reconciles
 * which accounts are suspended, which is how a projection is restored after
 * being lost, and how Moments recorded before a new dimension existed acquire
 * their rows in it.
 *
 * **Prefer `--version` for anything but a small repair.** Rebuilding in place
 * rewrites rows that are already there, and each one costs a ClickHouse
 * mutation of a second or more — measured at 2.3 Moments a second locally, and
 * that rate does not improve with a bigger machine because the cost is per
 * Moment. Naming a version that does not exist yet writes into empty tables
 * instead: nothing to replace, no mutations, inserts only.
 *
 * That is the flow `deployment.md:809` prescribes — build the new version,
 * validate it, switch readers, retire the old. This command does the building.
 * Pointing readers at a version is configuration and is not done here, so a
 * version built this way is complete and not yet read by anything.
 *
 * With `--only` it rebuilds exactly those Moments and leaves the suspension
 * dimension alone: that is a repair rather than a restoration, and an operator
 * fixing one Moment should not have every account reconsidered underneath them.
 *
 * Reads PostgreSQL and never the event log, so a Moment somebody erased stays
 * erased — replaying events would resurrect exactly what erasure removed.
 *
 * Requires the ClickHouse tables to exist: run `pnpm clickhouse:migrate` first.
 * Safe to run while the projector runs, and safe to run twice.
 *
 * @returns Nothing, once the rebuild finishes.
 * @throws {Error} If an argument is not recognised.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      only: { type: "string", multiple: true },
      version: { type: "string" },
    },
    allowPositionals: false,
  });

  const config = loadConfig();
  const database = createDatabase(config.database);
  await connectDatabase(database);

  const analytics = createAnalytics(config.clickhouse);
  const source = new TimelineSourceRepository(database.dataSource);
  const version = values.version ?? TIMELINE_VERSION;
  const projector = new TimelineProjector(
    database.dataSource,
    new TimelineRepository(analytics.client, version),
    source,
  );

  process.stdout.write(
    values.only === undefined
      ? `Rebuilding every Moment into ${version}\n`
      : `Rebuilding ${values.only.length} Moment(s) into ${version}\n`,
  );

  try {
    const report = await rebuildTimeline(projector, source, {
      ...(values.only === undefined ? {} : { only: values.only }),
      onProgress: (done) => {
        process.stdout.write(`  ${done}\n`);
      },
    });

    process.stdout.write(
      `Projected ${report.projected}, removed ${report.removed}, ` +
        `withheld ${report.suspended}, released ${report.reinstated}\n`,
    );
  } finally {
    // After the stores are closed, not instead of closing them. A rebuild that
    // failed partway has written every row it reached, and the connections it
    // held are worth returning either way.
    await analytics.close();
    await database.close();
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof ConfigurationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`Timeline rebuild failed: ${String(error)}\n${usage}\n`);
  }
  process.exit(1);
}
