import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { AuthConfig } from "../../config/auth-config.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { UnauthenticatedError } from "../../lib/errors/unauthorized-error.js";
import { systemContext } from "../../types/request-context.js";
import { createIdentity } from "../../testing/fixtures.js";
import { UserRepository } from "../users/user.repository.js";
import { SessionRepository } from "./session.repository.js";
import { SessionService } from "./session.service.js";

/**
 * Sessions, driven through the service against real infrastructure.
 *
 * The authentication suite covers what a person can do through HTTP. This one
 * covers what the Session itself decides, which is the question asked on every
 * authenticated request: may this Session act right now? Reading the row is
 * what makes revocation immediate, so the row is what these tests read.
 *
 * Requires `pnpm infra:up`.
 */

const config: AuthConfig = {
  jwtSecret: new TextEncoder().encode("integration-test-secret-long-enough-for-hs256"),
  issuer: "chronologity",
  audience: "chronologity-clients",
  accessTokenTtlSeconds: 600,
  refreshTokenTtlSeconds: 2_592_000,
  magicLinkTtlSeconds: 900,
  magicLinkBaseUrl: "http://localhost:3000/auth/sessions",
  passwordHashing: { memoryCostKib: 8_192, timeCost: 1, parallelism: 1 },
  passwordPolicy: { minimumLength: 12, maximumLength: 256 },
};

describe("sessions", () => {
  let database: Database;
  let sessions: SessionService;
  let now = new Date();

  beforeAll(async () => {
    database = createDatabase({
      host: process.env.POSTGRES_HOST ?? "localhost",
      port: Number(process.env.POSTGRES_PORT ?? "5432"),
      database: process.env.POSTGRES_DATABASE ?? "chronologity",
      user: process.env.POSTGRES_USER ?? "chronologity",
      password: process.env.POSTGRES_PASSWORD ?? "chronologity",
    });
    await connectDatabase(database);
    await migrate(database.dataSource);

    sessions = new SessionService(
      database.dataSource,
      new SessionRepository(database.dataSource),
      new UserRepository(database.dataSource),
      config,
      () => now,
    );
  });

  afterAll(async () => {
    await database.close();
  });

  const context = () => systemContext(randomUUID(), new Date());

  /** A Session belonging to a fresh Identity. */
  const open = async () => {
    const identityId = await createIdentity(database.dataSource);
    const credentials = await sessions.issue({
      identityId,
      clientKind: "test",
      method: "magic_link",
      context: context(),
    });

    return { identityId, credentials };
  };

  describe("deciding whether a session may act", () => {
    it("refuses a session that does not exist", async () => {
      // A signed, unexpired token naming a Session nobody has must authenticate
      // nothing, and must do so without an error the caller can read anything
      // from.
      assert.equal(await sessions.validate(randomUUID()), undefined);
    });

    it("accepts an open session, and reports whose it is", async () => {
      const { identityId, credentials } = await open();

      assert.deepEqual(await sessions.validate(credentials.sessionId), { identityId });
    });

    it("refuses a revoked session immediately, without waiting for expiry", async () => {
      const { identityId, credentials } = await open();

      await sessions.revoke(credentials.sessionId, identityId, "user_logout", context());

      // Revocation is written in the request that causes it, so the very next
      // read sees it. This is what makes the row a safe authority.
      assert.equal(await sessions.validate(credentials.sessionId), undefined);
    });

    it("refuses a session that has outlived its expiry", async () => {
      const { credentials } = await open();

      now = new Date(now.getTime() + (config.refreshTokenTtlSeconds + 60) * 1000);

      // Expiry is the passage of time rather than an action anyone takes, so it
      // is judged against the clock rather than against a stored status.
      assert.equal(await sessions.validate(credentials.sessionId), undefined);

      now = new Date();
    });
  });

  describe("ending a session", () => {
    it("refuses to end one that does not exist", async () => {
      await assert.rejects(
        sessions.revoke(randomUUID(), randomUUID(), "user_logout", context()),
        UnauthenticatedError,
      );
    });

    it("refuses to end somebody else's exactly as one that does not exist", async () => {
      const mine = await open();
      const theirs = await open();

      const asMissing = await sessions
        .revoke(randomUUID(), mine.identityId, "user_logout", context())
        .catch((error: unknown) => error);
      const asTheirs = await sessions
        .revoke(theirs.credentials.sessionId, mine.identityId, "user_logout", context())
        .catch((error: unknown) => error);

      // Reported identically, so this cannot be used to discover which session
      // identifiers are real.
      assert.ok(asMissing instanceof UnauthenticatedError);
      assert.ok(asTheirs instanceof UnauthenticatedError);
      assert.equal(asMissing.message, asTheirs.message);

      // And theirs is untouched.
      assert.notEqual(await sessions.validate(theirs.credentials.sessionId), undefined);
    });

    it("keeps the reason that ended it when a later logout arrives", async () => {
      const { identityId, credentials } = await open();

      await sessions.revoke(credentials.sessionId, identityId, "refresh_token_reuse", context());
      await sessions.revoke(credentials.sessionId, identityId, "user_logout", context());

      const rows: { revocation_reason: string }[] = await database.dataSource.query(
        `SELECT revocation_reason FROM sessions WHERE session_id = $1`,
        [credentials.sessionId],
      );

      // A logout must not overwrite evidence of a suspected theft.
      assert.equal(rows[0]?.revocation_reason, "refresh_token_reuse");
    });
  });

  describe("ending every session", () => {
    it("spares the one asking when told to", async () => {
      const identityId = await createIdentity(database.dataSource);
      const issue = () =>
        sessions.issue({ identityId, clientKind: "test", method: "password", context: context() });

      const keep = await issue();
      await issue();
      await issue();

      const revoked = await sessions.revokeAll({
        identityId,
        reason: "password_changed",
        exceptSessionId: keep.sessionId,
        context: context(),
      });

      assert.equal(revoked, 2);
      assert.notEqual(await sessions.validate(keep.sessionId), undefined);
    });

    it("counts nothing when there is nothing open", async () => {
      const revoked = await sessions.revokeAll({
        identityId: randomUUID(),
        reason: "account_deactivated",
        context: context(),
      });

      assert.equal(revoked, 0);
    });

    it("records which sessions ended, not merely how many", async () => {
      const identityId = await createIdentity(database.dataSource);
      const first = await sessions.issue({
        identityId,
        clientKind: "test",
        method: "password",
        context: context(),
      });
      const second = await sessions.issue({
        identityId,
        clientKind: "test",
        method: "password",
        context: context(),
      });

      await sessions.revokeAll({ identityId, reason: "password_reset", context: context() });

      const rows: { session_id: string }[] = await database.dataSource.query(
        `SELECT session_id FROM auth_audit_events
          WHERE identity_id = $1 AND event_type = 'session_revoked'`,
        [identityId],
      );

      // Which sessions ended is what an investigation needs, and a count alone
      // cannot answer it.
      assert.deepEqual(
        rows.map((row) => row.session_id).sort(),
        [first.sessionId, second.sessionId].sort(),
      );
    });
  });

  describe("listing", () => {
    it("shows what is open, newest first, with the caller's own marked", async () => {
      const identityId = await createIdentity(database.dataSource);
      const older = await sessions.issue({
        identityId,
        clientKind: "test",
        method: "password",
        context: context(),
      });

      now = new Date(now.getTime() + 1000);

      const newer = await sessions.issue({
        identityId,
        clientKind: "test",
        method: "password",
        context: context(),
      });

      const listed = await sessions.list(identityId, newer.sessionId);

      assert.deepEqual(
        listed.map((entry) => entry.sessionId),
        [newer.sessionId, older.sessionId],
      );
      assert.deepEqual(
        listed.map((entry) => entry.current),
        [true, false],
      );

      now = new Date();
    });

    it("omits a revoked session rather than showing it as ended", async () => {
      const identityId = await createIdentity(database.dataSource);
      const kept = await sessions.issue({
        identityId,
        clientKind: "test",
        method: "password",
        context: context(),
      });
      const gone = await sessions.issue({
        identityId,
        clientKind: "test",
        method: "password",
        context: context(),
      });

      await sessions.revoke(gone.sessionId, identityId, "user_logout", context());

      // Somebody reviewing their devices wants to know what is open now.
      assert.deepEqual(
        (await sessions.list(identityId, kept.sessionId)).map((entry) => entry.sessionId),
        [kept.sessionId],
      );
    });
  });
});
