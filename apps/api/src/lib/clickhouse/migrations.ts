import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ClickHouseClient } from "@clickhouse/client";
import type { Logger } from "../logger/logger.js";

/**
 * Applying ClickHouse schema changes.
 *
 * A second runner beside the relational one rather than a mode of it. The two
 * stores take different DDL, fail in different ways, and are migrated at
 * different moments — the API migrates PostgreSQL because it cannot serve
 * without it, while these tables belong to a projection that can be rebuilt.
 * One runner covering both would have to know which it was talking to at every
 * step, which is a worse arrangement than two that each know one thing.
 *
 * **There is no lock, and that is deliberate rather than overlooked.**
 * PostgreSQL migrations take an advisory lock so a second migrator waits.
 * ClickHouse has no equivalent that works without Keeper, and a lock would
 * promise more than it could deliver here: its DDL is not transactional, so two
 * runners racing cannot be made to interleave safely by excluding each other
 * anyway. What makes a race harmless instead is that every statement is written
 * to be repeatable — `CREATE TABLE IF NOT EXISTS` and nothing that fails when
 * it has already been done.
 */

const MIGRATIONS_DIRECTORY = new URL("../../../migrations/clickhouse/", import.meta.url);

/** `YYYYMMDDHHMMSS-<kebab-case-name>`, matching the relational convention. */
const VERSION_PATTERN = /^\d{14}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface AnalyticsMigrationResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: number;
}

/**
 * Whether a filename follows the convention.
 *
 * @param file - The filename, with or without its extension.
 * @returns Whether it is a timestamp and a kebab-case name.
 */
export function isValidAnalyticsMigrationName(file: string): boolean {
  return VERSION_PATTERN.test(file.replace(/\.sql$/, ""));
}

/**
 * Read the ClickHouse migrations directory.
 *
 * @returns Every migration on disk, in filename order.
 * @throws {Error} If any filename departs from the convention, for the same
 *   reason the relational runner refuses one: a name outside it sorts somewhere
 *   unintended, and a migration applied out of order is not something a schema
 *   can be talked out of afterwards.
 */
async function readMigrations(): Promise<{ version: string; sql: string }[]> {
  const entries = await readdir(fileURLToPath(MIGRATIONS_DIRECTORY));
  const files = entries.filter((entry) => entry.endsWith(".sql")).sort();
  const malformed = files.filter((file) => !isValidAnalyticsMigrationName(file));

  if (malformed.length > 0) {
    throw new Error(
      `ClickHouse migration filenames must be <UTC timestamp>-<name>.sql. Offending: ${malformed.join(", ")}`,
    );
  }

  return Promise.all(
    files.map(async (file) => ({
      version: file.replace(/\.sql$/, ""),
      sql: await readFile(new URL(file, MIGRATIONS_DIRECTORY), "utf8"),
    })),
  );
}

/**
 * Split a migration into statements.
 *
 * @param sql - The file's contents.
 * @returns Each statement, comments and blank lines removed. ClickHouse's HTTP
 *   interface takes one statement per request, so a file describing a table and
 *   its projection has to be divided rather than sent whole.
 */
function statementsIn(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/**
 * Apply every ClickHouse migration that has not yet been applied.
 *
 * @param client - The ClickHouse client.
 * @param logger - Optional; each applied migration is announced through it.
 * @returns Which migrations were applied, and how many had already been.
 * @throws {Error} If a statement fails. Earlier migrations stay applied and
 *   this one is not recorded, so a corrected file re-runs from its first
 *   statement — which is why every statement must be repeatable.
 */
export async function migrateAnalytics(
  client: ClickHouseClient,
  logger?: Logger,
): Promise<AnalyticsMigrationResult> {
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    String,
        applied_at DateTime64(3) DEFAULT now64(3)
      ) ENGINE = ReplacingMergeTree(applied_at) ORDER BY version
    `,
  });

  const recorded = await client.query({
    query: "SELECT version FROM schema_migrations",
    format: "JSONEachRow",
  });
  const applied = new Set((await recorded.json<{ version: string }>()).map((row) => row.version));

  const migrations = await readMigrations();
  const ran: string[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      continue;
    }

    for (const statement of statementsIn(migration.sql)) {
      await client.command({ query: statement });
    }

    await client.insert({
      table: "schema_migrations",
      values: [{ version: migration.version }],
      format: "JSONEachRow",
    });

    ran.push(migration.version);
    logger?.info({ version: migration.version }, "Applied ClickHouse migration");
  }

  return { applied: ran, alreadyApplied: migrations.length - ran.length };
}
