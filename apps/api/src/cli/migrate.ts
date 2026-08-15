import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "../config/app-config.js";
import { createDatabase } from "../lib/database/postgres.js";
import { migrate } from "../lib/database/migrations.js";

/**
 * Apply schema migrations.
 *
 * A deliberate command rather than something the API does on boot: replicas
 * starting together would otherwise race to migrate the same database
 * (ADR-059), and a deploy should be able to migrate before new code serves
 * traffic rather than as a side effect of it.
 */
try {
  const config = loadConfig();
  const database = createDatabase(config.database);

  try {
    const { applied, alreadyApplied } = await migrate(database.pool);

    if (applied.length === 0) {
      process.stdout.write(`No pending migrations (${alreadyApplied} already applied)\n`);
    } else {
      process.stdout.write(`Applied ${applied.length} migration(s):\n`);
      for (const version of applied) {
        process.stdout.write(`  ${version}\n`);
      }
    }
  } finally {
    await database.close();
  }
} catch (error) {
  if (error instanceof ConfigurationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`Migration failed: ${String(error)}\n`);
  }
  process.exit(1);
}
