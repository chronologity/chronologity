import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import { migrate } from "../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../lib/database/postgres.js";
import { createUser } from "../testing/fixtures.js";
import { grantRole } from "./grant-role.command.js";

/**
 * The command that makes the first administrator.
 *
 * Tested against the real database because that is where its authority comes
 * from: there is no Viewer, no token, and no permission check to stub. What can
 * be proven here is that it acts on the account somebody named and no other,
 * and that it leaves the audit evidence a privileged change is required to
 * leave.
 *
 * Requires `pnpm infra:up`. Run with `pnpm test:integration`.
 */

const databaseConfig = {
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? "5432"),
  database: process.env.POSTGRES_DATABASE ?? "chronologity",
  user: process.env.POSTGRES_USER ?? "chronologity",
  password: process.env.POSTGRES_PASSWORD ?? "chronologity",
};

describe("granting a role from the command line", () => {
  let database: Database;

  beforeAll(async () => {
    database = createDatabase(databaseConfig);
    await connectDatabase(database);
    await migrate(database.dataSource);
  });

  afterAll(() => database.close());

  const rolesOf = async (userId: string): Promise<string[]> => {
    const rows: { role: string }[] = await database.dataSource.query(
      `SELECT role FROM authorization_user_roles WHERE user_id = $1 ORDER BY role`,
      [userId],
    );

    return rows.map((row) => row.role);
  };

  const auditFor = async (
    userId: string,
  ): Promise<{ actor_user_id: string | null; reason: string | null }[]> =>
    database.dataSource.query(
      `SELECT actor_user_id, reason FROM authorization_audit_events
        WHERE subject_user_id = $1 ORDER BY occurred_at`,
      [userId],
    );

  it("makes the first administrator when there is nobody to ask", async () => {
    const person = await createUser(database.dataSource);

    const outcome = await grantRole(
      { handle: person.handle, role: "administrator", remove: false },
      database.dataSource,
    );

    assert.equal(outcome.kind, "changed");
    assert.deepEqual(await rolesOf(person.userId), ["administrator"]);
  });

  it("removes a role that is held", async () => {
    const person = await createUser(database.dataSource);
    await grantRole(
      { handle: person.handle, role: "moderator", remove: false },
      database.dataSource,
    );

    const outcome = await grantRole(
      { handle: person.handle, role: "moderator", remove: true },
      database.dataSource,
    );

    assert.equal(outcome.kind, "changed");
    assert.deepEqual(await rolesOf(person.userId), []);
  });

  it("reports no change when the role is already held", async () => {
    const person = await createUser(database.dataSource);
    await grantRole(
      { handle: person.handle, role: "moderator", remove: false },
      database.dataSource,
    );

    const outcome = await grantRole(
      { handle: person.handle, role: "moderator", remove: false },
      database.dataSource,
    );

    // Not a failure. The state asked for already holds, and a command run
    // twice should not look like it went wrong the second time.
    assert.equal(outcome.kind, "unchanged");
    assert.match(outcome.message, /already holds/);
    assert.deepEqual(await rolesOf(person.userId), ["moderator"]);
  });

  it("reports no change when removing a role that is not held", async () => {
    const person = await createUser(database.dataSource);

    const outcome = await grantRole(
      { handle: person.handle, role: "moderator", remove: true },
      database.dataSource,
    );

    assert.equal(outcome.kind, "unchanged");
    assert.match(outcome.message, /does not hold/);
  });

  it("finds the account however the handle was capitalised", async () => {
    const person = await createUser(database.dataSource);

    const outcome = await grantRole(
      { handle: person.handle.toUpperCase(), role: "moderator", remove: false },
      database.dataSource,
    );

    assert.equal(outcome.kind, "changed");
    assert.deepEqual(await rolesOf(person.userId), ["moderator"]);
  });

  it("records the change with no acting person and the reason given", async () => {
    const person = await createUser(database.dataSource);

    await grantRole(
      {
        handle: person.handle,
        role: "administrator",
        reason: "bootstrapping the first administrator",
        remove: false,
      },
      database.dataSource,
    );

    const audit = await auditFor(person.userId);

    // Blank because there genuinely is no acting User, which is the whole
    // point of this command. The reason is what makes that explicable later.
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.actor_user_id, null);
    assert.equal(audit[0]?.reason, "bootstrapping the first administrator");
  });

  it("records a reason even when nobody gave one", async () => {
    const person = await createUser(database.dataSource);

    await grantRole(
      { handle: person.handle, role: "moderator", remove: false },
      database.dataSource,
    );

    const audit = await auditFor(person.userId);

    assert.notEqual(audit[0]?.reason, null);
  });

  it("refuses a role that does not exist, naming what was typed", async () => {
    const person = await createUser(database.dataSource);

    const outcome = await grantRole(
      { handle: person.handle, role: "superuser", remove: false },
      database.dataSource,
    );

    assert.equal(outcome.kind, "refused");
    assert.match(outcome.message, /superuser/);
    assert.deepEqual(await rolesOf(person.userId), []);
  });

  it("refuses a handle nobody holds", async () => {
    const outcome = await grantRole(
      { handle: `nobody${randomUUID().slice(0, 8)}`, role: "moderator", remove: false },
      database.dataSource,
    );

    assert.equal(outcome.kind, "refused");
    assert.match(outcome.message, /No account currently holds/);
  });

  it("refuses a handle whose claim was released", async () => {
    const person = await createUser(database.dataSource);
    await database.dataSource.query(
      `UPDATE user_handles SET released_at = now() WHERE user_id = $1`,
      [person.userId],
    );

    const outcome = await grantRole(
      { handle: person.handle, role: "administrator", remove: false },
      database.dataSource,
    );

    // A released handle may since have been taken by somebody else. Granting on
    // the strength of an old claim would hand a role to the wrong account.
    assert.equal(outcome.kind, "refused");
    assert.deepEqual(await rolesOf(person.userId), []);
  });

  it("refuses when the handle is missing", async () => {
    const outcome = await grantRole({ role: "moderator", remove: false }, database.dataSource);

    assert.equal(outcome.kind, "refused");
  });

  it("refuses when the role is missing", async () => {
    const person = await createUser(database.dataSource);

    const outcome = await grantRole({ handle: person.handle, remove: false }, database.dataSource);

    assert.equal(outcome.kind, "refused");
    assert.deepEqual(await rolesOf(person.userId), []);
  });
});
