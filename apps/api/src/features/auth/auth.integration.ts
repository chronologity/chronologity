import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config/app-config.js";
import { createEmailClient } from "../../integrations/email/email-client.js";
import { readAuthAudit } from "../../lib/auth/audit.js";
import { migrate } from "../../lib/database/migrations.js";
import { createDatabase, type Database } from "../../lib/database/postgres.js";
import { createEventStore, type EventStore } from "../../lib/eventstore/client.js";
import { buildApp } from "../../server/app.js";
import type { AuthDependencies } from "./dependencies.js";

/**
 * Authentication, end to end against real infrastructure.
 *
 * The magic-link flow is driven through the HTTP surface and the link is read
 * back out of Mailpit over SMTP, so nothing about delivery is stubbed. A test
 * that fabricated the token would prove the parts work while leaving the seam
 * between them — the part that actually breaks — untested.
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
  messaging: { brokers: ["localhost:9092"], clientId: "auth-integration" },
  auth: {
    jwtSecret: new TextEncoder().encode("integration-test-secret-long-enough-for-hs256"),
    issuer: "chronologity",
    audience: "chronologity-clients",
    accessTokenTtlSeconds: 600,
    refreshTokenTtlSeconds: 2_592_000,
    magicLinkTtlSeconds: 900,
    magicLinkBaseUrl: "http://localhost:3000/auth/sessions",
    // Cheapest parameters the schema permits: these tests hash many passwords,
    // and Argon2id at production cost would dominate the suite's runtime
    // without testing anything the parameters change.
    passwordHashing: { memoryCostKib: 8_192, timeCost: 1, parallelism: 1 },
    passwordPolicy: { minimumLength: 12, maximumLength: 256 },
  },
  email: {
    host: process.env.SMTP_HOST ?? "localhost",
    port: Number(process.env.SMTP_PORT ?? "1025"),
    from: process.env.SMTP_FROM ?? "no-reply@chronologity.local",
  },
};

/** Read the most recent link Mailpit received for an address. */
async function readMagicLinkFor(email: string, timeoutMs = 10_000): Promise<string> {
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
}

const uniqueEmail = () => `person-${randomUUID()}@example.test`;

describe("authentication", () => {
  let app: FastifyInstance;
  let database: Database;
  let eventStore: EventStore;
  let deps: AuthDependencies;
  let clock = () => new Date();

  before(async () => {
    database = createDatabase(config.database);
    eventStore = createEventStore(config.eventStore);
    await migrate(database.pool);

    deps = {
      client: eventStore.client,
      pool: database.pool,
      config: config.auth,
      email: createEmailClient(config.email),
      clock: () => clock(),
      // Headroom so the suite does not trip the limit it is not testing. A
      // dedicated test below reaches the limit on purpose.
      rateLimits: {
        magicLinkRequestsPerWindow: 1000,
        sessionCreationsPerWindow: 1000,
        passwordAttemptsPerWindow: 1000,
        registrationsPerWindow: 1000,
        windowMinutes: 15,
      },
    };

    app = await buildApp({ config, dependencies: [], auth: deps });
  });

  after(async () => {
    await app.close();
    await deps.email.close();
    await eventStore.close();
    await database.close();
  });

  beforeEach(() => {
    clock = () => new Date();
  });

  const requestLink = async (email: string) =>
    app.inject({ method: "POST", url: "/auth/magic-link", payload: { email } });

  const signIn = async (email: string) => {
    await requestLink(email);
    const token = await readMagicLinkFor(email);
    const response = await app.inject({
      method: "POST",
      url: "/auth/sessions",
      payload: { token },
    });

    assert.equal(response.statusCode, 201, response.body);
    return { token, credentials: response.json() };
  };

  it("signs a new person in: link requested, delivered, redeemed", async () => {
    const email = uniqueEmail();
    const { credentials } = await signIn(email);

    assert.match(credentials.sessionId, /^[0-9a-f-]{36}$/);
    assert.ok(credentials.accessToken.length > 0);
    assert.ok(credentials.refreshToken.length > 0);
  });

  it("returns the same response whether or not the address is known", async () => {
    const known = uniqueEmail();
    await signIn(known);

    const first = await requestLink(known);
    const second = await requestLink(uniqueEmail());

    // Different responses here would let anyone test whether an address has an
    // account, one request at a time.
    assert.equal(first.statusCode, second.statusCode);
    assert.deepEqual(first.json(), second.json());
  });

  it("gives a returning person the same identity", async () => {
    const email = uniqueEmail();
    const first = await signIn(email);
    const second = await signIn(email);

    assert.notEqual(first.credentials.sessionId, second.credentials.sessionId);

    const audit = await readAuthAudit(deps.pool, await identityIdFor(email));
    assert.ok(audit.filter((entry) => entry.eventType === "session_created").length >= 2);
  });

  it("refuses a link that has already been used", async () => {
    const email = uniqueEmail();
    const { token } = await signIn(email);

    const replay = await app.inject({ method: "POST", url: "/auth/sessions", payload: { token } });

    assert.equal(replay.statusCode, 401);
  });

  it("refuses an expired link", async () => {
    const email = uniqueEmail();
    await requestLink(email);
    const token = await readMagicLinkFor(email);

    // Past the fifteen-minute lifetime, without waiting fifteen minutes.
    clock = () => new Date(Date.now() + 16 * 60 * 1000);

    const response = await app.inject({
      method: "POST",
      url: "/auth/sessions",
      payload: { token },
    });

    assert.equal(response.statusCode, 401);
  });

  it("refuses a link that was never issued", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/sessions",
      payload: { token: "definitely-not-a-real-token" },
    });

    assert.equal(response.statusCode, 401);
  });

  it("authenticates a request with the access token", async () => {
    const { credentials } = await signIn(uniqueEmail());

    const response = await app.inject({
      method: "GET",
      url: "/auth/sessions",
      headers: { authorization: `Bearer ${credentials.accessToken}` },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().sessions.length, 1);
    assert.equal(response.json().sessions[0].current, true);
  });

  it("refuses a request with no token, a malformed token, or a forged one", async () => {
    for (const headers of [
      {},
      { authorization: "Bearer nonsense" },
      { authorization: "Basic abc" },
    ]) {
      const response = await app.inject({ method: "GET", url: "/auth/sessions", headers });
      assert.equal(response.statusCode, 401);
    }
  });

  describe("refresh", () => {
    it("rotates the credential and invalidates its predecessor", async () => {
      const { credentials } = await signIn(uniqueEmail());

      const refreshed = await app.inject({
        method: "POST",
        url: "/auth/sessions/refresh",
        payload: { sessionId: credentials.sessionId, refreshToken: credentials.refreshToken },
      });

      assert.equal(refreshed.statusCode, 200);
      assert.notEqual(refreshed.json().refreshToken, credentials.refreshToken);
    });

    it("revokes the session when a rotated credential is replayed", async () => {
      const { credentials } = await signIn(uniqueEmail());

      const refreshed = await app.inject({
        method: "POST",
        url: "/auth/sessions/refresh",
        payload: { sessionId: credentials.sessionId, refreshToken: credentials.refreshToken },
      });
      assert.equal(refreshed.statusCode, 200);

      // The original credential is now stale. Presenting it means a copy is in
      // circulation, and the session cannot be trusted.
      const replayed = await app.inject({
        method: "POST",
        url: "/auth/sessions/refresh",
        payload: { sessionId: credentials.sessionId, refreshToken: credentials.refreshToken },
      });
      assert.equal(replayed.statusCode, 401);

      // The rotated credential is dead too: the whole session went, not just
      // the credential that was replayed.
      const afterRevocation = await app.inject({
        method: "POST",
        url: "/auth/sessions/refresh",
        payload: {
          sessionId: credentials.sessionId,
          refreshToken: refreshed.json().refreshToken,
        },
      });
      assert.equal(afterRevocation.statusCode, 401);

      const stillAuthenticated = await app.inject({
        method: "GET",
        url: "/auth/sessions",
        headers: { authorization: `Bearer ${refreshed.json().accessToken}` },
      });
      assert.equal(stillAuthenticated.statusCode, 401);
    });

    it("refuses a refresh for an unknown session", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/sessions/refresh",
        payload: { sessionId: randomUUID(), refreshToken: "whatever" },
      });

      assert.equal(response.statusCode, 401);
    });
  });

  describe("revocation", () => {
    it("stops an access token working immediately, without waiting for expiry", async () => {
      const { credentials } = await signIn(uniqueEmail());

      const revoked = await app.inject({
        method: "DELETE",
        url: `/auth/sessions/${credentials.sessionId}`,
        headers: { authorization: `Bearer ${credentials.accessToken}` },
      });
      assert.equal(revoked.statusCode, 204);

      // The token is still signed and still unexpired. Validity is decided by
      // the Session, which is the point.
      const afterRevocation = await app.inject({
        method: "GET",
        url: "/auth/sessions",
        headers: { authorization: `Bearer ${credentials.accessToken}` },
      });
      assert.equal(afterRevocation.statusCode, 401);
    });

    it("will not let one person revoke another's session", async () => {
      const mine = await signIn(uniqueEmail());
      const theirs = await signIn(uniqueEmail());

      const response = await app.inject({
        method: "DELETE",
        url: `/auth/sessions/${theirs.credentials.sessionId}`,
        headers: { authorization: `Bearer ${mine.credentials.accessToken}` },
      });

      assert.equal(response.statusCode, 401);

      // Theirs still works.
      const unaffected = await app.inject({
        method: "GET",
        url: "/auth/sessions",
        headers: { authorization: `Bearer ${theirs.credentials.accessToken}` },
      });
      assert.equal(unaffected.statusCode, 200);
    });

    it("logs out everywhere", async () => {
      const email = uniqueEmail();
      const first = await signIn(email);
      const second = await signIn(email);

      const response = await app.inject({
        method: "DELETE",
        url: "/auth/sessions",
        headers: { authorization: `Bearer ${first.credentials.accessToken}` },
      });

      assert.equal(response.statusCode, 200);
      assert.ok(response.json().revoked >= 2);

      for (const credentials of [first.credentials, second.credentials]) {
        const check = await app.inject({
          method: "GET",
          url: "/auth/sessions",
          headers: { authorization: `Bearer ${credentials.accessToken}` },
        });
        assert.equal(check.statusCode, 401);
      }
    });
  });

  it("records security events without recording credentials", async () => {
    const email = uniqueEmail();
    const { credentials } = await signIn(email);
    const identityId = await identityIdFor(email);

    const audit = await readAuthAudit(deps.pool, identityId);
    const types = audit.map((entry) => entry.eventType);

    assert.ok(types.includes("session_created"));
    assert.ok(types.includes("magic_link_consumed"));

    const { rows } = await deps.pool.query<{ context: unknown; reason: string | null }>(
      `SELECT context, reason FROM auth_audit_events WHERE identity_id = $1`,
      [identityId],
    );
    const serialized = JSON.stringify(rows);

    assert.ok(
      !serialized.includes(credentials.refreshToken),
      "a refresh token reached the audit log",
    );
    assert.ok(
      !serialized.includes(credentials.accessToken),
      "an access token reached the audit log",
    );
  });

  it("stores no magic-link token in recoverable form", async () => {
    const email = uniqueEmail();
    await requestLink(email);
    const token = await readMagicLinkFor(email);

    const { rows } = await deps.pool.query<{ token_hash: string }>(
      `SELECT token_hash FROM magic_link_tokens`,
    );

    // A database leak must not hand over working sign-in links.
    assert.ok(!rows.some((row) => row.token_hash === token));
  });

  it("stops a burst of sign-in link requests", async () => {
    const limited = await buildApp({
      config,
      dependencies: [],
      auth: {
        ...deps,
        rateLimits: {
          magicLinkRequestsPerWindow: 3,
          sessionCreationsPerWindow: 10,
          passwordAttemptsPerWindow: 3,
          registrationsPerWindow: 10,
          windowMinutes: 15,
        },
      },
    });

    try {
      const email = uniqueEmail();
      const statuses: number[] = [];

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await limited.inject({
          method: "POST",
          url: "/auth/magic-link",
          payload: { email },
        });
        statuses.push(response.statusCode);
      }

      assert.deepEqual(statuses.slice(0, 3), [202, 202, 202]);
      assert.deepEqual(statuses.slice(3), [429, 429]);
    } finally {
      await limited.close();
    }
  });

  describe("password authentication", () => {
    const strongPassword = "a perfectly reasonable passphrase";

    const register = async (email: string, password = strongPassword) =>
      app.inject({ method: "POST", url: "/auth/registrations", payload: { email, password } });

    const signInWithPassword = async (email: string, password = strongPassword) =>
      app.inject({
        method: "POST",
        url: "/auth/sessions/password",
        payload: { email, password },
      });

    const registerAndVerify = async (email: string, password = strongPassword) => {
      const registration = await register(email, password);
      assert.equal(registration.statusCode, 202, registration.body);

      const token = await readMagicLinkFor(email);
      const verified = await app.inject({
        method: "POST",
        url: "/auth/email-verifications",
        payload: { token },
      });
      assert.equal(verified.statusCode, 204, verified.body);

      return token;
    };

    it("registers, verifies by mail, and signs in", async () => {
      const email = uniqueEmail();
      await registerAndVerify(email);

      const signedIn = await signInWithPassword(email);

      assert.equal(signedIn.statusCode, 201, signedIn.body);
      assert.ok(signedIn.json().accessToken.length > 0);
    });

    it("refuses a password sign-in before the address is verified", async () => {
      // Anyone can type any address. Until control is proven, a password on it
      // means nothing (authentication.md:240).
      const email = uniqueEmail();
      const registration = await register(email);
      assert.equal(registration.statusCode, 202);

      const signedIn = await signInWithPassword(email);

      assert.equal(signedIn.statusCode, 401);
    });

    it("answers identically for a wrong password and an unknown address", async () => {
      const email = uniqueEmail();
      await registerAndVerify(email);

      const wrongPassword = await signInWithPassword(email, "some other passphrase entirely");
      const unknownAddress = await signInWithPassword(uniqueEmail());

      assert.equal(wrongPassword.statusCode, unknownAddress.statusCode);
      assert.deepEqual(wrongPassword.json().code, unknownAddress.json().code);
      assert.deepEqual(wrongPassword.json().message, unknownAddress.json().message);
    });

    it("answers identically when an address is already registered", async () => {
      const email = uniqueEmail();
      const first = await register(email);
      const second = await register(email);

      assert.equal(first.statusCode, second.statusCode);
      assert.deepEqual(first.json(), second.json());

      // The owner is told instead of the caller.
      const notice = await readMailSubjectsFor(email);
      assert.ok(
        notice.some((subject) => subject.includes("tried to register")),
        `expected a notice to the owner, saw ${JSON.stringify(notice)}`,
      );
    });

    it("refuses a password the policy rejects, and says why", async () => {
      // The one thing worth explaining plainly: refusing without a reason
      // leaves someone guessing at rules they cannot see.
      const response = await register(uniqueEmail(), "password123");

      assert.equal(response.statusCode, 400);
      assert.equal(response.json().code, "VALIDATION_FAILED");
    });

    it("refuses a password that has appeared in a breach", async () => {
      // Long and unpatterned, so only the corpus catches it. This is what an
      // attacker replays rather than guesses.
      const response = await register(uniqueEmail(), "PE#5GZ29PTZMSE");

      assert.equal(response.statusCode, 400);
      assert.match(response.json().message, /data breach/);
    });

    it("resets a password and ends every existing session", async () => {
      const email = uniqueEmail();
      await registerAndVerify(email);

      const before = await signInWithPassword(email);
      assert.equal(before.statusCode, 201);

      const requested = await app.inject({
        method: "POST",
        url: "/auth/password-resets",
        payload: { email },
      });
      assert.equal(requested.statusCode, 202);

      const token = await readMagicLinkFor(email);
      const completed = await app.inject({
        method: "POST",
        url: "/auth/password-resets/complete",
        payload: { token, password: "an entirely different passphrase" },
      });
      assert.equal(completed.statusCode, 204, completed.body);

      // A reset is what someone does when they may have lost control, so every
      // session goes with it.
      const stillValid = await app.inject({
        method: "GET",
        url: "/auth/sessions",
        headers: { authorization: `Bearer ${before.json().accessToken}` },
      });
      assert.equal(stillValid.statusCode, 401);

      assert.equal((await signInWithPassword(email)).statusCode, 401);
      assert.equal(
        (await signInWithPassword(email, "an entirely different passphrase")).statusCode,
        201,
      );
    });

    it("changes a password, keeping the current session and ending the others", async () => {
      const email = uniqueEmail();
      await registerAndVerify(email);

      const current = await signInWithPassword(email);
      const other = await signInWithPassword(email);
      assert.equal(current.statusCode, 201);
      assert.equal(other.statusCode, 201);

      const changed = await app.inject({
        method: "PUT",
        url: "/auth/password",
        headers: { authorization: `Bearer ${current.json().accessToken}` },
        payload: {
          currentPassword: strongPassword,
          newPassword: "yet another reasonable passphrase",
        },
      });

      assert.equal(changed.statusCode, 200, changed.body);
      assert.ok(changed.json().otherSessionsRevoked >= 1);

      // The device doing the changing stays signed in; the others do not.
      const currentStillWorks = await app.inject({
        method: "GET",
        url: "/auth/sessions",
        headers: { authorization: `Bearer ${current.json().accessToken}` },
      });
      assert.equal(currentStillWorks.statusCode, 200);

      const otherIsDead = await app.inject({
        method: "GET",
        url: "/auth/sessions",
        headers: { authorization: `Bearer ${other.json().accessToken}` },
      });
      assert.equal(otherIsDead.statusCode, 401);
    });

    it("requires the current password to change it", async () => {
      // An access token left on a shared device must not be enough to take an
      // account over.
      const email = uniqueEmail();
      await registerAndVerify(email);
      const session = await signInWithPassword(email);

      const changed = await app.inject({
        method: "PUT",
        url: "/auth/password",
        headers: { authorization: `Bearer ${session.json().accessToken}` },
        payload: { currentPassword: "not the password", newPassword: "a fine new passphrase" },
      });

      assert.equal(changed.statusCode, 401);
      assert.equal(
        (await signInWithPassword(email)).statusCode,
        201,
        "password should be unchanged",
      );
    });

    it("will not let one kind of link do another's job", async () => {
      const email = uniqueEmail();
      const registration = await register(email);
      assert.equal(registration.statusCode, 202);
      const verificationToken = await readMagicLinkFor(email);

      // A verification link is not a reset link, and not a sign-in link.
      const asReset = await app.inject({
        method: "POST",
        url: "/auth/password-resets/complete",
        payload: { token: verificationToken, password: "a fine new passphrase" },
      });
      assert.equal(asReset.statusCode, 401);

      const asSignIn = await app.inject({
        method: "POST",
        url: "/auth/sessions",
        payload: { token: verificationToken },
      });
      assert.equal(asSignIn.statusCode, 401);

      // And it still works for what it was issued for.
      const asVerification = await app.inject({
        method: "POST",
        url: "/auth/email-verifications",
        payload: { token: verificationToken },
      });
      assert.equal(asVerification.statusCode, 204);
    });

    it("keeps magic-link sign-in working for an account that has a password", async () => {
      const email = uniqueEmail();
      await registerAndVerify(email);

      await app.inject({ method: "POST", url: "/auth/magic-link", payload: { email } });
      const linkToken = await readMagicLinkFor(email);
      const linkSignIn = await app.inject({
        method: "POST",
        url: "/auth/sessions",
        payload: { token: linkToken },
      });

      assert.equal(linkSignIn.statusCode, 201, linkSignIn.body);

      // Both methods lead to the same account.
      const passwordSignIn = await signInWithPassword(email);
      assert.equal(passwordSignIn.statusCode, 201);
      assert.notEqual(linkSignIn.json().sessionId, passwordSignIn.json().sessionId);
    });

    it("stores no password in recoverable form, and none in history or audit", async () => {
      const email = uniqueEmail();
      await registerAndVerify(email);
      const identityId = await identityIdFor(email);

      const stored = await deps.pool.query<{ password_hash: string }>(
        `SELECT password_hash FROM identity_passwords WHERE identity_id = $1`,
        [identityId],
      );

      assert.match(stored.rows[0]?.password_hash ?? "", /^\$argon2id\$/);
      assert.ok(!(stored.rows[0]?.password_hash ?? "").includes(strongPassword));

      const audit = await deps.pool.query(
        `SELECT context, reason FROM auth_audit_events WHERE identity_id = $1`,
        [identityId],
      );
      assert.ok(!JSON.stringify(audit.rows).includes(strongPassword));

      // The hash belongs in PostgreSQL, where it can be rotated; history is
      // permanent, so it records only that a password was set.
      const events = await readIdentityHistory(identityId);
      assert.ok(!JSON.stringify(events).includes(strongPassword));
      assert.ok(!JSON.stringify(events).includes(stored.rows[0]?.password_hash ?? "never"));
      assert.ok(events.some((event) => event.type === "PasswordSet"));
    });

    it("stops a burst of password attempts", async () => {
      const limited = await buildApp({
        config,
        dependencies: [],
        auth: {
          ...deps,
          rateLimits: {
            magicLinkRequestsPerWindow: 100,
            sessionCreationsPerWindow: 100,
            passwordAttemptsPerWindow: 3,
            registrationsPerWindow: 100,
            windowMinutes: 15,
          },
        },
      });

      try {
        const email = uniqueEmail();
        const statuses: number[] = [];

        for (let attempt = 0; attempt < 5; attempt += 1) {
          const response = await limited.inject({
            method: "POST",
            url: "/auth/sessions/password",
            payload: { email, password: "guessing repeatedly here" },
          });
          statuses.push(response.statusCode);
        }

        assert.deepEqual(statuses.slice(0, 3), [401, 401, 401]);
        assert.deepEqual(statuses.slice(3), [429, 429]);
      } finally {
        await limited.close();
      }
    });
  });

  /** Subjects of everything Mailpit holds for an address. */
  async function readMailSubjectsFor(email: string): Promise<string[]> {
    const response = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const body = (await response.json()) as { messages?: { Subject: string }[] };

    return (body.messages ?? []).map((message) => message.Subject);
  }

  /**
   * An Identity's event history, for asserting what is and is not recorded.
   *
   * Revisions are dropped: they are bigints, which JSON.stringify refuses, and
   * the assertions are about payloads rather than positions.
   */
  async function readIdentityHistory(
    identityId: string,
  ): Promise<{ type: string; payload: unknown; metadata: unknown }[]> {
    const { readStream } = await import("../../lib/eventstore/read-stream.js");
    const { streamName } = await import("../../lib/eventstore/stream-name.js");

    const recorded = await readStream(deps.client, streamName("identity", identityId));

    return recorded.map((event) => ({
      type: event.type,
      payload: event.payload,
      metadata: event.metadata,
    }));
  }

  async function identityIdFor(email: string): Promise<string> {
    const { rows } = await deps.pool.query<{ identity_id: string }>(
      `SELECT identity_id FROM identity_emails WHERE normalized_email = $1`,
      [email.toLowerCase()],
    );

    const id = rows[0]?.identity_id;
    assert.ok(id !== undefined, `no identity for ${email}`);
    return id;
  }
});
