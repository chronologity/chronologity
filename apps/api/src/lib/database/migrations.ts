import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import type { Logger } from "../logger/logger.js";

/**
 * Schema migrations.
 *
 * Migrations run as a deliberate step, never on application boot: every API
 * replica starting at once would otherwise race to migrate the same database
 * (ADR-059). An advisory lock makes that race safe even when it happens by
 * accident, but the lock is a safety net, not the design.
 *
 * Each migration runs inside its own transaction together with the row
 * recording it, so a failure leaves neither a half-applied schema nor a
 * migration that claims to have run.
 *
 * Filenames are `<UTC timestamp>_<name>.sql`:
 *
 *     20260815031100-foundation.sql
 *
 * The prefix is YYYYMMDDHHMMSS in UTC. Being fixed-width, it sorts
 * lexicographically in the same order it sorts chronologically, so ordering is
 * a property of the name rather than of a counter someone has to maintain. A
 * sequential prefix would collide the moment two branches add a migration in
 * parallel — a merge conflict at best, two migrations silently sharing a
 * number at worst.
 *
 * Generate names with `scripts/new-migration.sh`, which uses `date -u`. The
 * timestamp must be UTC: a contributor in another timezone must not be able to
 * write a migration that sorts before one already applied.
 */

/** Arbitrary but fixed: identifies this repository's migration lock. */
const ADVISORY_LOCK_KEY = 8_264_119_570_001n;

const MIGRATIONS_DIRECTORY = new URL("../../../migrations/", import.meta.url);

/** `YYYYMMDDHHMMSS-<kebab-case-name>`, e.g. `20260815031100-foundation`. */
const VERSION_PATTERN = /^\d{14}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: number;
}

async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function readMigrations(): Promise<{ version: string; sql: string }[]> {
  const entries = await readdir(fileURLToPath(MIGRATIONS_DIRECTORY));

  const files = entries.filter((entry) => entry.endsWith(".sql")).sort();

  const malformed = files.filter((file) => !VERSION_PATTERN.test(file.replace(/\.sql$/, "")));

  if (malformed.length > 0) {
    // Refused rather than tolerated: a name outside the convention sorts
    // somewhere unintended, and a migration applied out of order is not
    // something the schema can be talked out of afterwards.
    throw new Error(
      `Migration filenames must be <UTC timestamp>_<name>.sql, e.g. 20260815031100-add-moments.sql. Offending: ${malformed.join(", ")}`,
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
 * Apply every migration that has not yet been applied.
 *
 * Migrations are applied in filename order, which is why they are numbered.
 * An already-applied migration is never re-run and never re-checked: editing
 * a migration that has shipped is a schema change of its own and needs a new
 * file, not an edit.
 */
export async function migrate(pool: pg.Pool, logger?: Logger): Promise<MigrationResult> {
  const client = await pool.connect();

  try {
    // Held for the whole run and released with the connection. A second
    // migrator waits here rather than interleaving.
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY.toString()]);
    await ensureMigrationsTable(client);

    const { rows } = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations",
    );
    const applied = new Set(rows.map((row) => row.version));

    const migrations = await readMigrations();
    const pending = migrations.filter((migration) => !applied.has(migration.version));

    for (const migration of pending) {
      logger?.info({ version: migration.version }, "Applying migration");

      try {
        await client.query("BEGIN");
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [
          migration.version,
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${migration.version} failed: ${String(error)}`, {
          cause: error,
        });
      }
    }

    return {
      applied: pending.map((migration) => migration.version),
      alreadyApplied: applied.size,
    };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY.toString()]);
    client.release();
  }
}
