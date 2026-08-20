import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import pg from "pg";
import { migrate } from "./migrations.js";

/**
 * Applying migrations to a database that has none.
 *
 * Every other suite calls `migrate()` against a database that is already
 * migrated, so nothing is pending and the loop that actually applies one never
 * runs. The code that applies a migration — and, more importantly, the code
 * that rolls one back when it fails — was therefore never executed by a test.
 *
 * A failing migration mid-deploy is exactly when rollback has to be right, so
 * it is exercised here against a real database, with a real failure, by
 * arranging a genuine conflict rather than by injecting a fake migration file
 * into the repository's migrations directory.
 *
 * Requires `pnpm infra:up`. Run with `pnpm test:integration`.
 */

const connection = {
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? "5432"),
  user: process.env.POSTGRES_USER ?? "chronologity",
  password: process.env.POSTGRES_PASSWORD ?? "chronologity",
};

const ADMIN_DATABASE = process.env.POSTGRES_DATABASE ?? "chronologity";

describe("applying migrations to an empty database", () => {
  let admin: pg.Pool;
  const created: string[] = [];

  beforeAll(() => {
    admin = new pg.Pool({ ...connection, database: ADMIN_DATABASE });
  });

  afterAll(async () => {
    for (const name of created) {
      // FORCE, because a pool that failed to close would otherwise leave a
      // database behind on every run until something noticed.
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    }
    await admin.end();
  });

  /** A database of its own, so nothing here can disturb the shared one. */
  const emptyDatabase = async (): Promise<pg.Pool> => {
    const name = `chronologity_migrate_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

    await admin.query(`CREATE DATABASE ${name}`);
    created.push(name);

    return new pg.Pool({ ...connection, database: name });
  };

  const tableExists = async (pool: pg.Pool, table: string): Promise<boolean> => {
    const { rows } = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS exists`,
      [table],
    );

    return rows[0]?.exists === true;
  };

  it("applies every migration, in filename order, and records each one", async () => {
    const pool = await emptyDatabase();

    try {
      const result = await migrate(pool);

      assert.equal(result.alreadyApplied, 0);
      assert.ok(result.applied.length > 0, "an empty database had nothing to apply");

      // Filename order is chronological order, because the prefix is a
      // fixed-width UTC timestamp. A migration applied out of order is not
      // something a schema can be talked out of afterwards.
      assert.deepEqual(result.applied, [...result.applied].sort());

      const { rows } = await pool.query<{ version: string }>(
        `SELECT version FROM schema_migrations ORDER BY version`,
      );
      assert.deepEqual(
        rows.map((row) => row.version),
        [...result.applied].sort(),
      );

      // And the schema those migrations describe actually exists.
      for (const table of ["users", "sessions", "uploads", "locations", "outbox_messages"]) {
        assert.ok(await tableExists(pool, table), `expected table ${table}`);
      }
    } finally {
      await pool.end();
    }
  });

  it("applies nothing the second time", async () => {
    const pool = await emptyDatabase();

    try {
      const first = await migrate(pool);
      const second = await migrate(pool);

      // Migrations are a deliberate step that every replica may run. Running
      // twice must be a no-op rather than an error.
      assert.deepEqual(second.applied, []);
      assert.equal(second.alreadyApplied, first.applied.length);
    } finally {
      await pool.end();
    }
  });

  it("leaves neither the schema change nor the version row when a migration fails", async () => {
    const pool = await emptyDatabase();

    try {
      // A genuine conflict rather than a fabricated one: `users` already
      // exists, so the migration that creates it cannot. That migration creates
      // `user_handles` first, which means the failure happens partway through
      // and the rollback has real work to undo.
      await pool.query(`CREATE TABLE users (user_id uuid PRIMARY KEY)`);

      await assert.rejects(migrate(pool), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /^Migration \d{14}-add-users failed:/);
        // The original failure is kept as the cause; the wrapper only says
        // which migration it was.
        assert.ok(error.cause !== undefined);
        return true;
      });

      const { rows } = await pool.query<{ version: string }>(
        `SELECT version FROM schema_migrations ORDER BY version`,
      );
      const versions = rows.map((row) => row.version);

      // Everything before it committed, because each migration is its own
      // transaction. That is the design, not a partial failure.
      assert.ok(versions.length > 0);
      assert.ok(
        versions.every((version) => version < "20260815200650"),
        `expected nothing at or after the failing migration, saw ${versions.join(", ")}`,
      );

      // The failing migration claims nothing.
      assert.ok(!versions.includes("20260815200650-add-users"));

      // And its partial work is gone: `user_handles` was created inside the
      // same transaction, before the statement that failed.
      assert.equal(
        await tableExists(pool, "user_handles"),
        false,
        "a rolled-back migration left a table behind",
      );
    } finally {
      await pool.end();
    }
  });

  it("can be completed after the obstruction is removed", async () => {
    const pool = await emptyDatabase();

    try {
      await pool.query(`CREATE TABLE users (user_id uuid PRIMARY KEY)`);
      await assert.rejects(migrate(pool));

      // Nothing about the failure is sticky: no lock is held, no half-state
      // recorded. Removing the obstruction and running again finishes the job.
      await pool.query(`DROP TABLE users`);
      const result = await migrate(pool);

      assert.ok(result.applied.includes("20260815200650-add-users"));
      assert.ok(await tableExists(pool, "user_handles"));
    } finally {
      await pool.end();
    }
  });
});
