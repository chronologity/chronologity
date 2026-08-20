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

  /** A User and its Identity, inserted directly. */
  const seedUser = async (pool: pg.Pool): Promise<{ identityId: string; userId: string }> => {
    const identityId = randomUUID();
    const userId = randomUUID();
    const handle = `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;

    await pool.query(`INSERT INTO identities (identity_id, created_at) VALUES ($1, now())`, [
      identityId,
    ]);
    await pool.query(
      `INSERT INTO users (user_id, identity_id, handle, display_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Test Person', 'active', now(), now())`,
      [userId, identityId, handle],
    );
    await pool.query(
      `INSERT INTO user_handles (normalized_handle, handle, user_id, assigned_at)
       VALUES ($1, $2, $3, now())`,
      [handle.toLowerCase(), handle, userId],
    );

    return { identityId, userId };
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

  it("refuses a row whose parent does not exist", async () => {
    const pool = await emptyDatabase();

    try {
      await migrate(pool);

      // The whole purpose of the constraints. Before them a Session could name
      // an Identity nobody had, and nothing objected.
      await assert.rejects(
        pool.query(
          `INSERT INTO sessions (session_id, identity_id, created_at, expires_at, refresh_generation)
           VALUES (gen_random_uuid(), gen_random_uuid(), now(), now() + interval '1 day', 0)`,
        ),
        /violates foreign key constraint/,
      );

      await assert.rejects(
        pool.query(
          `INSERT INTO uploads
             (upload_id, owner_user_id, kind, declared_content_type, declared_byte_size,
              storage_key, state, registered_at, expires_at, updated_at, attempts, derivatives)
           VALUES (gen_random_uuid(), gen_random_uuid(), 'image', 'image/jpeg', 1,
                   'k', 'registered', now(), now() + interval '1 hour', now(), 0, ARRAY[]::text[])`,
        ),
        /violates foreign key constraint/,
      );
    } finally {
      await pool.end();
    }
  });

  it("refuses to delete an account that still owns something", async () => {
    const pool = await emptyDatabase();

    try {
      await migrate(pool);
      const { identityId, userId } = await seedUser(pool);

      await pool.query(
        `INSERT INTO uploads
           (upload_id, owner_user_id, kind, declared_content_type, declared_byte_size,
            storage_key, state, registered_at, expires_at, updated_at, attempts, derivatives)
         VALUES (gen_random_uuid(), $1, 'image', 'image/jpeg', 1,
                 'k', 'registered', now(), now() + interval '1 hour', now(), 0, ARRAY[]::text[])`,
        [userId],
      );

      // Account deletion is not `DELETE FROM users` (`users.md:299`). The
      // constraint makes the database say so rather than quietly cascading and
      // leaving the object-storage bytes behind.
      //
      // Which dependant objects first is not the point and not asserted: the
      // handle happens to be checked before the upload. The point is that
      // something does, every time, until each has been dealt with.
      await assert.rejects(
        pool.query(`DELETE FROM users WHERE user_id = $1`, [userId]),
        /foreign key constraint/,
      );

      await assert.rejects(
        pool.query(`DELETE FROM identities WHERE identity_id = $1`, [identityId]),
        /foreign key constraint/,
      );
    } finally {
      await pool.end();
    }
  });

  it("keeps a role granted by an account that is later removed", async () => {
    const pool = await emptyDatabase();

    try {
      await migrate(pool);
      const subject = await seedUser(pool);
      const admin = await seedUser(pool);

      await pool.query(
        `INSERT INTO authorization_user_roles (user_id, role, assigned_at, assigned_by)
         VALUES ($1, 'moderator', now(), $2)`,
        [subject.userId, admin.userId],
      );

      // The administrator's own handle is the only thing referencing them here.
      await pool.query(`DELETE FROM user_handles WHERE user_id = $1`, [admin.userId]);
      await pool.query(`DELETE FROM users WHERE user_id = $1`, [admin.userId]);

      const { rows } = await pool.query<{ role: string; assigned_by: string | null }>(
        `SELECT role, assigned_by FROM authorization_user_roles WHERE user_id = $1`,
        [subject.userId],
      );

      // A role change survives the departure of whoever made it. What it loses
      // is the attribution, not the fact.
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.role, "moderator");
      assert.equal(rows[0]?.assigned_by, null);
    } finally {
      await pool.end();
    }
  });

  it("keeps audit records for an identity that no longer exists", async () => {
    const pool = await emptyDatabase();

    try {
      await migrate(pool);

      // Deliberately unconstrained. Audit rows are evidence retained on their
      // own basis, and they are meant to outlive what they describe — a foreign
      // key here would force a choice between destroying evidence and
      // preventing erasure.
      await pool.query(
        `INSERT INTO auth_audit_events (id, event_type, identity_id, outcome)
         VALUES (gen_random_uuid(), 'session_created', gen_random_uuid(), 'success')`,
      );

      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM auth_audit_events`,
      );
      assert.equal(rows[0]?.count, "1");
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
