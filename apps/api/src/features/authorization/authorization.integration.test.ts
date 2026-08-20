import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config/app-config.js";
import { migrate } from "../../lib/database/migrations.js";
import { createDatabase, type Database } from "../../lib/database/postgres.js";
import { withTransaction } from "../../lib/database/transaction.js";
import { buildApp } from "../../server/app.js";
import { createTestAuthentication, type TestAuthentication } from "../../testing/authentication.js";
import { UserRepository } from "../users/user.repository.js";
import { UserService } from "../users/user.service.js";
import { AuthorizationRepository } from "./authorization.repository.js";
import { AuthorizationService } from "./authorization.service.js";

/**
 * Authorization, end to end against real infrastructure.
 *
 * Everyone here signs in for real and creates a real account, because the
 * question under test is what a genuine Viewer may do. A fabricated token
 * carrying a role claim would test the fabrication rather than the policy —
 * and roles deliberately do not live in tokens at all.
 *
 * Requires `pnpm infra:up`. Run with `pnpm test:integration`.
 */

const MAILPIT = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? "8025"}`;

const config: AppConfig = {
  nodeEnv: "test",
  logLevel: "fatal",
  host: "127.0.0.1",
  port: 0,
  database: {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? "5432"),
    database: process.env.POSTGRES_DATABASE ?? "chronologity",
    user: process.env.POSTGRES_USER ?? "chronologity",
    password: process.env.POSTGRES_PASSWORD ?? "chronologity",
  },
  eventStore: {
    connectionString: process.env.EVENTSTOREDB_URL ?? "esdb://localhost:2113?tls=false",
  },
  messaging: { brokers: ["localhost:9092"], clientId: "authorization-integration" },
  auth: {
    jwtSecret: new TextEncoder().encode("integration-test-secret-long-enough-for-hs256"),
    issuer: "chronologity",
    audience: "chronologity-clients",
    accessTokenTtlSeconds: 600,
    refreshTokenTtlSeconds: 2_592_000,
    magicLinkTtlSeconds: 900,
    magicLinkBaseUrl: "http://localhost:3000/auth/sessions",
    passwordHashing: { memoryCostKib: 8_192, timeCost: 1, parallelism: 1 },
    passwordPolicy: { minimumLength: 12, maximumLength: 256 },
  },
  minimumAgeYears: 13,
  storage: {
    endpoint: process.env.S3_ENDPOINT ?? "http://127.0.0.1:8333",
    region: process.env.S3_REGION ?? "us-east-1",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "chronologity",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "chronologity-local-secret",
    bucket: process.env.S3_BUCKET ?? "chronologity-media",
    forcePathStyle: true,
    uploadUrlTtlSeconds: 900,
  },
  uploadLimits: {
    registrationTtlSeconds: 3_600,
    maxImageBytes: 26_214_400,
    maxVideoBytes: 524_288_000,
  },
  places: {
    endpoint: "https://nominatim.openstreetmap.org/search",
    userAgent: "Chronologity/0.1 (test)",
    minimumIntervalMs: 0,
  },
  email: {
    host: process.env.SMTP_HOST ?? "localhost",
    port: Number(process.env.SMTP_PORT ?? "1025"),
    from: process.env.SMTP_FROM ?? "no-reply@chronologity.local",
  },
};

const ADULT = "1990-04-12";
const uniqueEmail = () => `person-${randomUUID()}@example.test`;
const uniqueHandle = () => `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;

describe("authorization", () => {
  let app: FastifyInstance;
  let database: Database;
  let authentication: TestAuthentication;
  let users: UserService;
  let authorization: AuthorizationService;
  let roles: AuthorizationRepository;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await migrate(database.pool);

    authentication = createTestAuthentication(database.pool, config.auth, config.email);

    users = new UserService(database.pool, new UserRepository(database.pool), {
      minimumAgeYears: config.minimumAgeYears,
    });

    roles = new AuthorizationRepository(database.pool);
    authorization = new AuthorizationService(database.pool, roles);

    app = await buildApp({ config, dependencies: [], authentication, users, authorization });
  });

  afterAll(async () => {
    await app.close();
    await authentication.close();
    await database.close();
  });

  /** Read the most recent sign-in link Mailpit received for an address. */
  const readLinkFor = async (email: string, timeoutMs = 10_000): Promise<string> => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const response = await fetch(
        `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
      );
      const body = (await response.json()) as { messages?: { ID: string }[] };
      const id = body.messages?.[0]?.ID;

      if (id !== undefined) {
        const message = await fetch(`${MAILPIT}/api/v1/message/${id}`);
        const detail = (await message.json()) as { Text?: string };
        const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(detail.Text ?? "")?.[1];

        if (token !== undefined) {
          return token;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    throw new Error(`No sign-in link arrived for ${email}`);
  };

  const authed = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });

  /** Sign in and create an account, ending with an ordinary User. */
  const onboard = async () => {
    const email = uniqueEmail();
    await app.inject({ method: "POST", url: "/auth/magic-link", payload: { email } });
    const token = await readLinkFor(email);
    const session = await app.inject({
      method: "POST",
      url: "/auth/sessions",
      payload: { token },
    });

    assert.equal(session.statusCode, 201, session.body);

    const credentials = session.json();
    const created = await app.inject({
      method: "POST",
      url: "/users",
      headers: authed(credentials.accessToken),
      payload: { handle: uniqueHandle(), displayName: "Test Person", dateOfBirth: ADULT },
    });

    assert.equal(created.statusCode, 201, created.body);

    return { credentials, user: created.json() };
  };

  /**
   * An administrator, made the only way a first one can be made: outside the
   * permission system, exactly as the CLI does it.
   */
  const onboardAdministrator = async () => {
    const account = await onboard();

    await authorization.assign(
      account.user.userId,
      "administrator",
      undefined,
      "integration test",
      { traceId: randomUUID(), actor: undefined, receivedAt: new Date() },
    );

    return account;
  };

  describe("capabilities", () => {
    it("gives an ordinary User the baseline role and nothing else", async () => {
      const { credentials } = await onboard();

      const response = await app.inject({
        method: "GET",
        url: "/users/me/capabilities",
        headers: authed(credentials.accessToken),
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json().roles, ["user"]);
      assert.deepEqual(response.json().permissions, []);
    });

    it("requires an account, not merely authentication", async () => {
      const email = uniqueEmail();
      await app.inject({ method: "POST", url: "/auth/magic-link", payload: { email } });
      const token = await readLinkFor(email);
      const session = await app.inject({
        method: "POST",
        url: "/auth/sessions",
        payload: { token },
      });

      const response = await app.inject({
        method: "GET",
        url: "/users/me/capabilities",
        headers: authed(session.json().accessToken),
      });

      assert.equal(response.statusCode, 403);
      assert.equal(response.json().code, "ONBOARDING_REQUIRED");
    });

    it("reports the permissions an administrator's role confers", async () => {
      const { credentials } = await onboardAdministrator();

      const response = await app.inject({
        method: "GET",
        url: "/users/me/capabilities",
        headers: authed(credentials.accessToken),
      });

      assert.deepEqual(response.json().roles, ["user", "administrator"]);
      assert.deepEqual(response.json().permissions, ["admin:user-role-manage"]);
    });
  });

  describe("role management", () => {
    it("refuses an ordinary User, who may not grant roles", async () => {
      const actor = await onboard();
      const subject = await onboard();

      const response = await app.inject({
        method: "PUT",
        url: `/users/${subject.user.userId}/roles/moderator`,
        headers: authed(actor.credentials.accessToken),
        payload: {},
      });

      assert.equal(response.statusCode, 403);
      assert.equal(response.json().code, "AUTHORIZATION_DENIED");
    });

    it("refuses an ordinary User trying to grant themselves a role", async () => {
      // The guard refuses before the aggregate is even consulted. Both checks
      // exist; this proves the outer one.
      const actor = await onboard();

      const response = await app.inject({
        method: "PUT",
        url: `/users/${actor.user.userId}/roles/administrator`,
        headers: authed(actor.credentials.accessToken),
        payload: {},
      });

      assert.equal(response.statusCode, 403);

      const after = await app.inject({
        method: "GET",
        url: "/users/me/capabilities",
        headers: authed(actor.credentials.accessToken),
      });

      assert.deepEqual(after.json().roles, ["user"]);
    });

    it("refuses an administrator granting a role to themselves", async () => {
      // The inner check: this caller passes the permission guard and is still
      // refused, because nobody escalates their own privileges.
      const admin = await onboardAdministrator();

      const response = await app.inject({
        method: "PUT",
        url: `/users/${admin.user.userId}/roles/moderator`,
        headers: authed(admin.credentials.accessToken),
        payload: {},
      });

      assert.equal(response.statusCode, 403);
    });

    it("lets an administrator grant a role", async () => {
      const admin = await onboardAdministrator();
      const subject = await onboard();

      const response = await app.inject({
        method: "PUT",
        url: `/users/${subject.user.userId}/roles/moderator`,
        headers: authed(admin.credentials.accessToken),
        payload: { reason: "joining the review team" },
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(
        response.json().roles.map((assignment: { role: string }) => assignment.role),
        ["moderator"],
      );

      const capabilities = await app.inject({
        method: "GET",
        url: "/users/me/capabilities",
        headers: authed(subject.credentials.accessToken),
      });

      assert.deepEqual(capabilities.json().roles, ["user", "moderator"]);
    });

    it("records who granted the role", async () => {
      const admin = await onboardAdministrator();
      const subject = await onboard();

      await app.inject({
        method: "PUT",
        url: `/users/${subject.user.userId}/roles/moderator`,
        headers: authed(admin.credentials.accessToken),
        payload: {},
      });

      const response = await app.inject({
        method: "GET",
        url: `/users/${subject.user.userId}/roles`,
        headers: authed(admin.credentials.accessToken),
      });

      assert.equal(response.json().roles[0].assignedBy, admin.user.userId);
    });

    it("is idempotent: granting a role already held writes nothing", async () => {
      const admin = await onboardAdministrator();
      const subject = await onboard();

      const grant = async () =>
        app.inject({
          method: "PUT",
          url: `/users/${subject.user.userId}/roles/moderator`,
          headers: authed(admin.credentials.accessToken),
          payload: {},
        });

      assert.equal((await grant()).statusCode, 200);
      assert.equal((await grant()).statusCode, 200);

      const audit = await roles.auditFor(subject.user.userId);

      // PUT declares a desired state, so asking twice succeeds twice; but
      // history should record what happened, and the second time nothing did.
      assert.equal(audit.filter((row) => row.eventType === "user_role_assigned").length, 1);
    });

    it("refuses a role change for an account that does not exist", async () => {
      const admin = await onboardAdministrator();

      const response = await app.inject({
        method: "PUT",
        url: `/users/${randomUUID()}/roles/moderator`,
        headers: authed(admin.credentials.accessToken),
        payload: {},
      });

      assert.equal(response.statusCode, 404);
    });

    it("records an audit row for a change no request asked for", async () => {
      // Roles can be granted outside a request — the first administrator has to
      // come from somewhere, and `removedBy: undefined` is the command line.
      // Such a change has no trace to attribute it to, and must still leave
      // evidence: audit is where privileged operations are accounted for.
      const subject = await onboard();
      const roles = new AuthorizationRepository(database.pool);

      await withTransaction(database.pool, (tx) =>
        roles.recordAudit(tx, {
          eventType: "user_role_assigned",
          outcome: "success",
          actorUserId: undefined,
          subjectUserId: subject.user.userId,
          role: "moderator",
          reason: "bootstrapped from the command line",
          context: { source: "cli" },
        }),
      );

      const { rows } = await database.pool.query<{ trace_id: string | null; context: unknown }>(
        `SELECT trace_id, context FROM authorization_audit_events WHERE subject_user_id = $1`,
        [subject.user.userId],
      );

      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.trace_id, null);
      assert.deepEqual(rows[0]?.context, { source: "cli" });
    });

    it("refuses to take a role from an account that does not exist", async () => {
      const admin = await onboardAdministrator();

      // Granting already refuses this. Removing has its own existence check,
      // and an unchecked remove would report success for an account nobody has.
      const response = await app.inject({
        method: "DELETE",
        url: `/users/${randomUUID()}/roles/moderator`,
        headers: authed(admin.credentials.accessToken),
      });

      assert.equal(response.statusCode, 404, response.body);
    });

    it("takes a role away without being sent a body", async () => {
      const admin = await onboardAdministrator();
      const subject = await onboard();

      await app.inject({
        method: "PUT",
        url: `/users/${subject.user.userId}/roles/moderator`,
        headers: authed(admin.credentials.accessToken),
        payload: {},
      });

      // No payload at all, which is the plainest way to call a delete. The
      // body is declared optional, and a request that omits it must be
      // accepted rather than refused for arriving as null.
      const response = await app.inject({
        method: "DELETE",
        url: `/users/${subject.user.userId}/roles/moderator`,
        headers: authed(admin.credentials.accessToken),
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json().roles, []);
    });

    it("rejects a role the platform does not define", async () => {
      const admin = await onboardAdministrator();
      const subject = await onboard();

      const response = await app.inject({
        method: "PUT",
        url: `/users/${subject.user.userId}/roles/superuser`,
        headers: authed(admin.credentials.accessToken),
        payload: {},
      });

      assert.equal(response.statusCode, 400);
    });

    it("refuses to grant the baseline role, which is not grantable", async () => {
      const admin = await onboardAdministrator();
      const subject = await onboard();

      const response = await app.inject({
        method: "PUT",
        url: `/users/${subject.user.userId}/roles/user`,
        headers: authed(admin.credentials.accessToken),
        payload: {},
      });

      assert.equal(response.statusCode, 400);
    });
  });

  describe("revocation", () => {
    it("takes effect on the very next request, with the same access token", async () => {
      // The reason roles are not carried in tokens. This token was issued
      // before the grant, survives the grant, and must stop working the moment
      // the role is taken away — no refresh, no expiry, no waiting.
      const admin = await onboardAdministrator();
      const subject = await onboardAdministrator();
      const bystander = await onboard();

      const worked = await app.inject({
        method: "PUT",
        url: `/users/${bystander.user.userId}/roles/moderator`,
        headers: authed(subject.credentials.accessToken),
        payload: {},
      });

      assert.equal(worked.statusCode, 200, "the subject could manage roles");

      await app.inject({
        method: "DELETE",
        url: `/users/${subject.user.userId}/roles/administrator`,
        headers: authed(admin.credentials.accessToken),
        payload: { reason: "no longer on the team" },
      });

      const refused = await app.inject({
        method: "PUT",
        url: `/users/${bystander.user.userId}/roles/administrator`,
        headers: authed(subject.credentials.accessToken),
        payload: {},
      });

      assert.equal(refused.statusCode, 403, "the same token must stop working");
    });

    it("lets an administrator stand down by removing their own role", async () => {
      const admin = await onboardAdministrator();

      const response = await app.inject({
        method: "DELETE",
        url: `/users/${admin.user.userId}/roles/administrator`,
        headers: authed(admin.credentials.accessToken),
        payload: { reason: "standing down" },
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json().roles, []);

      const capabilities = await app.inject({
        method: "GET",
        url: "/users/me/capabilities",
        headers: authed(admin.credentials.accessToken),
      });

      assert.deepEqual(capabilities.json().roles, ["user"]);
    });

    it("removing a role not held changes nothing and is not an error", async () => {
      const admin = await onboardAdministrator();
      const subject = await onboard();

      const response = await app.inject({
        method: "DELETE",
        url: `/users/${subject.user.userId}/roles/moderator`,
        headers: authed(admin.credentials.accessToken),
        payload: {},
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json().roles, []);
    });
  });

  describe("auditing", () => {
    it("records every privileged change with actor, subject, role, and trace", async () => {
      const admin = await onboardAdministrator();
      const subject = await onboard();

      await app.inject({
        method: "PUT",
        url: `/users/${subject.user.userId}/roles/moderator`,
        headers: authed(admin.credentials.accessToken),
        payload: { reason: "joining the review team" },
      });

      await app.inject({
        method: "DELETE",
        url: `/users/${subject.user.userId}/roles/moderator`,
        headers: authed(admin.credentials.accessToken),
        payload: { reason: "leaving the review team" },
      });

      const audit = await roles.auditFor(subject.user.userId);

      assert.deepEqual(
        audit.map((row) => row.eventType),
        ["user_role_removed", "user_role_assigned"],
      );

      for (const row of audit) {
        assert.equal(row.actorUserId, admin.user.userId);
        assert.equal(row.role, "moderator");
        assert.equal(row.outcome, "success");
        assert.ok(row.traceId !== null, "an audit record must be traceable");
        assert.match(row.reason ?? "", /review team/);
      }
    });

    it("records a refused self-escalation, which is what a review looks for", async () => {
      const admin = await onboardAdministrator();

      await app.inject({
        method: "PUT",
        url: `/users/${admin.user.userId}/roles/moderator`,
        headers: authed(admin.credentials.accessToken),
        payload: {},
      });

      const audit = await roles.auditFor(admin.user.userId);
      const refusal = audit.find((row) => row.outcome === "failure");

      assert.ok(refusal !== undefined, "the attempt must be recorded");
      assert.equal(refusal.reason, "self_assignment");
      assert.equal(refusal.actorUserId, admin.user.userId);
    });

    it("records a grant made with no acting User, as the CLI makes it", async () => {
      const { user } = await onboardAdministrator();

      const audit = await roles.auditFor(user.userId);

      assert.equal(audit[0]?.actorUserId, null);
      assert.equal(audit[0]?.role, "administrator");
    });
  });

  describe("reading roles", () => {
    it("is itself privileged: who holds authority is not public", async () => {
      const actor = await onboard();
      const subject = await onboard();

      const response = await app.inject({
        method: "GET",
        url: `/users/${subject.user.userId}/roles`,
        headers: authed(actor.credentials.accessToken),
      });

      assert.equal(response.statusCode, 403);
    });

    it("distinguishes an account with no roles from an account that does not exist", async () => {
      const admin = await onboardAdministrator();
      const subject = await onboard();

      const empty = await app.inject({
        method: "GET",
        url: `/users/${subject.user.userId}/roles`,
        headers: authed(admin.credentials.accessToken),
      });

      const missing = await app.inject({
        method: "GET",
        url: `/users/${randomUUID()}/roles`,
        headers: authed(admin.credentials.accessToken),
      });

      assert.equal(empty.statusCode, 200);
      assert.deepEqual(empty.json().roles, []);
      assert.equal(missing.statusCode, 404);
    });

    it("keeps roles out of the access token entirely", async () => {
      const { credentials } = await onboardAdministrator();

      const refreshed = await app.inject({
        method: "POST",
        url: "/auth/sessions/refresh",
        payload: { sessionId: credentials.sessionId, refreshToken: credentials.refreshToken },
      });

      const claims = JSON.parse(
        Buffer.from(refreshed.json().accessToken.split(".")[1] ?? "", "base64url").toString("utf8"),
      );

      // Even a token minted after the grant carries no privilege. A claim
      // would be a cache of authorization state, and this one does not exist
      // to go stale.
      assert.equal(JSON.stringify(claims).includes("administrator"), false);
      assert.equal(claims.roles, undefined);
      assert.equal(claims.permissions, undefined);
    });
  });
});
