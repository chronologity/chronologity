import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "../config/app-config.js";
import { createAnalytics } from "../lib/clickhouse/clickhouse.js";
import { migrateAnalytics } from "../lib/clickhouse/migrations.js";

/**
 * Create or update the ClickHouse tables the Timeline projection reads.
 *
 *     pnpm clickhouse:migrate
 *
 * A second command beside `migrate` rather than a mode of it, because the two
 * runners are separate for a reason the relational one states: every statement
 * here is `CREATE TABLE IF NOT EXISTS`, takes no lock, and is safe to repeat,
 * which is not true of the relational migrations and must not become their
 * problem.
 *
 * Run before deploying anything that reads the projection, and before
 * `timeline:rebuild` — a rebuild writes into tables it does not create.
 *
 * Safe to run twice, and safe to run while the projector runs.
 *
 * @returns Nothing, once the tables exist.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const analytics = createAnalytics(config.clickhouse);

  process.stdout.write(`Migrating ${config.clickhouse.database}\n`);

  const result = await migrateAnalytics(analytics.client);

  for (const name of result.applied) {
    process.stdout.write(`  ${name}\n`);
  }

  process.stdout.write(
    `Applied ${result.applied.length}, already present ${result.alreadyApplied}\n`,
  );

  await analytics.close();
}

try {
  await main();
} catch (error) {
  if (error instanceof ConfigurationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`ClickHouse migration failed: ${String(error)}\n`);
  }
  process.exit(1);
}
