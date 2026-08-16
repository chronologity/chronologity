import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config/app-config.js";
import { createEmailClient } from "../../integrations/email/email-client.js";
import { migrate } from "../../lib/database/migrations.js";
import { createDatabase, type Database } from "../../lib/database/postgres.js";
import { createEventStore, type EventStore } from "../../lib/eventstore/client.js";
import { buildApp } from "../../server/app.js";
import type { AuthDependencies } from "../auth/dependencies.js";
import type { UserDependencies } from "./dependencies.js";

/**
 * Users, end to end against real infrastructure.
 *
 * Every test signs in for real through the magic-link flow, because the thing
 * being tested is what happens between authenticating and having an account —
 * and a fabricated token would skip precisely that.
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
  messaging: { brokers: ["localhost:9092"], clientId: "users-integration" },
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
  email: {
    host: process.env.SMTP_HOST ?? "localhost",
    port: Number(process.env.SMTP_PORT ?? "1025"),
    from: process.env.SMTP_FROM ?? "no-reply@chronologity.local",
  },
};

/** Old enough under any plausible minimum, and fixed so the tests do not age. */
const ADULT = "1990-04-12";

const uniqueEmail = () => `person-${randomUUID()}@example.test`;

/** Handles must be unique across the whole database, including earlier runs. */
const uniqueHandle = () => `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;

describe("users", () => {
  let app: FastifyInstance;
  let database: Database;
  let eventStore: EventStore;
  let auth: AuthDependencies;
  let users: UserDependencies;

  beforeAll(async () => {
    database = createDatabase(config.database);
    eventStore = createEventStore(config.eventStore);
    await migrate(database.pool);

    auth = {
      client: eventStore.client,
      pool: database.pool,
      config: config.auth,
      email: createEmailClient(config.email),
      rateLimits: {
        magicLinkRequestsPerWindow: 1000,
        sessionCreationsPerWindow: 1000,
        passwordAttemptsPerWindow: 1000,
        registrationsPerWindow: 1000,
        windowMinutes: 15,
      },
    };

    // No injected clock: nothing here manipulates time. The handle cooldown is
    // exercised by claiming during it, which needs no clock at all.
    users = {
      client: eventStore.client,
      pool: database.pool,
      minimumAgeYears: config.minimumAgeYears,
    };

    app = await buildApp({ config, dependencies: [], auth, users });
  });

  afterAll(async () => {
    await app.close();
    await auth.email.close();
    await eventStore.close();
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

  /** Sign in for real, ending with an authenticated Identity and no account. */
  const signIn = async () => {
    const email = uniqueEmail();
    await app.inject({ method: "POST", url: "/auth/magic-link", payload: { email } });
    const token = await readLinkFor(email);
    const response = await app.inject({
      method: "POST",
      url: "/auth/sessions",
      payload: { token },
    });

    assert.equal(response.statusCode, 201, response.body);

    return { email, credentials: response.json() };
  };

  const authed = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });

  /** Sign in and complete account creation. */
  const onboard = async (handle = uniqueHandle()) => {
    const { email, credentials } = await signIn();
    const created = await app.inject({
      method: "POST",
      url: "/users",
      headers: authed(credentials.accessToken),
      payload: { handle, displayName: "Test Person", dateOfBirth: ADULT },
    });

    assert.equal(created.statusCode, 201, created.body);

    return { email, credentials, handle, user: created.json() };
  };

  it("signs in, has no account, then creates one", async () => {
    const { credentials } = await signIn();

    const before = await app.inject({
      method: "GET",
      url: "/users/me",
      headers: authed(credentials.accessToken),
    });

    assert.equal(before.statusCode, 403);
    assert.equal(before.json().code, "ONBOARDING_REQUIRED");

    const handle = uniqueHandle();
    const created = await app.inject({
      method: "POST",
      url: "/users",
      headers: authed(credentials.accessToken),
      payload: {
        handle,
        displayName: "Test Person",
        biography: "Taking pictures",
        dateOfBirth: ADULT,
      },
    });

    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json().handle, handle);
    assert.equal(created.json().biography, "Taking pictures");
    assert.equal(created.json().status, "active");
  });

  it("works immediately after onboarding, before the token has caught up", async () => {
    // The token was issued before the account existed, so it carries no user
    // id. Making someone sign in again to see their own new profile would be
    // absurd; the guard falls back to a lookup.
    const { credentials } = await onboard();

    const response = await app.inject({
      method: "GET",
      url: "/users/me",
      headers: authed(credentials.accessToken),
    });

    assert.equal(response.statusCode, 200);
  });

  it("carries the user id in the token after a refresh", async () => {
    const { credentials, user } = await onboard();

    const refreshed = await app.inject({
      method: "POST",
      url: "/auth/sessions/refresh",
      payload: { sessionId: credentials.sessionId, refreshToken: credentials.refreshToken },
    });

    assert.equal(refreshed.statusCode, 200);

    const claims = JSON.parse(
      Buffer.from(refreshed.json().accessToken.split(".")[1] ?? "", "base64url").toString("utf8"),
    );

    assert.equal(claims.uid, user.userId);
  });

  it("refuses account creation twice for one Identity", async () => {
    const { credentials } = await onboard();

    const again = await app.inject({
      method: "POST",
      url: "/users",
      headers: authed(credentials.accessToken),
      payload: { handle: uniqueHandle(), displayName: "Someone Else", dateOfBirth: ADULT },
    });

    assert.equal(again.statusCode, 400);
  });

  describe("minimum age", () => {
    /** A birthdate a given number of years before today, to the day. */
    const bornYearsAgo = (years: number, offsetDays = 0) => {
      const date = new Date();
      date.setUTCFullYear(date.getUTCFullYear() - years);
      date.setUTCDate(date.getUTCDate() + offsetDays);

      return date.toISOString().slice(0, 10);
    };

    const attempt = async (dateOfBirth: string) => {
      const { credentials } = await signIn();

      return app.inject({
        method: "POST",
        url: "/users",
        headers: authed(credentials.accessToken),
        payload: { handle: uniqueHandle(), displayName: "Test Person", dateOfBirth },
      });
    };

    it("admits someone exactly at the minimum", async () => {
      // Thirteen today, to the day: the boundary belongs to the person on it.
      const response = await attempt(bornYearsAgo(config.minimumAgeYears));

      assert.equal(response.statusCode, 201, response.body);
    });

    it("refuses someone a day short of it", async () => {
      const response = await attempt(bornYearsAgo(config.minimumAgeYears, 1));

      assert.equal(response.statusCode, 400);
    });

    it("refuses without revealing the threshold", async () => {
      const response = await attempt(bornYearsAgo(5));
      const { message } = response.json();

      // An age gate that answers its own question only teaches people the
      // number, so nothing shown to them may name or imply it.
      assert.doesNotMatch(message, /\d/);
      assert.doesNotMatch(message, /\b(age|old|young|minimum|birth ?day)\b/i);
    });

    it("refuses an under-age account the same way as an unusable one", async () => {
      // Distinguishable refusals would let someone find the threshold by
      // bisection, which is the same as printing it.
      const tooYoung = await attempt(bornYearsAgo(5));
      const implausible = await attempt("1850-01-01");

      assert.equal(tooYoung.statusCode, implausible.statusCode);
      assert.equal(tooYoung.json().code, implausible.json().code);
      assert.equal(tooYoung.json().message, implausible.json().message);
    });

    it("refuses a date that is not a real date", async () => {
      const response = await attempt("2011-02-30");

      assert.equal(response.statusCode, 400);
    });

    it("refuses a date in the future", async () => {
      const response = await attempt(bornYearsAgo(-1));

      assert.equal(response.statusCode, 400);
    });

    it("leaves no account behind when it refuses", async () => {
      const { credentials } = await signIn();
      const handle = uniqueHandle();

      const refused = await app.inject({
        method: "POST",
        url: "/users",
        headers: authed(credentials.accessToken),
        payload: { handle, displayName: "Too Young", dateOfBirth: bornYearsAgo(5) },
      });

      assert.equal(refused.statusCode, 400);

      // The handle was never claimed, so it is still there for someone else.
      const { rows } = await database.pool.query(
        `SELECT 1 FROM user_handles WHERE normalized_handle = $1`,
        [handle.toLowerCase()],
      );

      assert.equal(rows.length, 0);
    });

    it("gives someone their own date of birth back, and nobody else theirs", async () => {
      const { credentials, handle } = await onboard();

      const mine = await app.inject({
        method: "GET",
        url: "/users/me",
        headers: authed(credentials.accessToken),
      });

      assert.equal(mine.json().dateOfBirth, ADULT);

      const theirs = await app.inject({ method: "GET", url: `/users/${handle}` });

      assert.equal(theirs.statusCode, 200);
      assert.equal(theirs.json().dateOfBirth, undefined);
    });

    it("keeps the date of birth out of event history", async () => {
      const { user } = await onboard();

      const { readStream } = await import("../../lib/eventstore/read-stream.js");
      const { streamName } = await import("../../lib/eventstore/stream-name.js");

      const recorded = await readStream(eventStore.client, streamName("user", user.userId));

      assert.ok(recorded.length > 0);

      // Stream revisions are BigInt, which JSON cannot serialise.
      const history = JSON.stringify(recorded, (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      );

      // History is permanent. A birthdate written there could not be erased
      // when someone asks for their data to be deleted.
      assert.doesNotMatch(history, new RegExp(ADULT));
      assert.doesNotMatch(history, /dateOfBirth/);
    });

    it("records the threshold the account was admitted under", async () => {
      const { user } = await onboard();

      const { rows } = await database.pool.query<{ minimum_age_at_creation: number }>(
        `SELECT minimum_age_at_creation FROM user_restricted_data WHERE user_id = $1`,
        [user.userId],
      );

      // The threshold is configuration. Without recording it, nobody can say
      // afterwards which rule an account was admitted under.
      assert.equal(rows[0]?.minimum_age_at_creation, config.minimumAgeYears);
    });
  });

  describe("handles", () => {
    it("gives a contested handle to exactly one of two simultaneous claims", async () => {
      const handle = uniqueHandle();
      const first = await signIn();
      const second = await signIn();

      const [a, b] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/users",
          headers: authed(first.credentials.accessToken),
          payload: { handle, displayName: "First", dateOfBirth: ADULT },
        }),
        app.inject({
          method: "POST",
          url: "/users",
          headers: authed(second.credentials.accessToken),
          payload: { handle, displayName: "Second", dateOfBirth: ADULT },
        }),
      ]);

      const statuses = [a.statusCode, b.statusCode].sort();

      // The database decides, not the application. Both succeeding would split
      // one name across two accounts.
      assert.deepEqual(statuses, [201, 400], `${a.body} | ${b.body}`);
    });

    it("treats case variants as the same handle", async () => {
      const handle = uniqueHandle();
      await onboard(handle);

      const other = await signIn();
      const taken = await app.inject({
        method: "POST",
        url: "/users",
        headers: authed(other.credentials.accessToken),
        payload: { handle: handle.toUpperCase(), displayName: "Impostor", dateOfBirth: ADULT },
      });

      assert.equal(taken.statusCode, 400);
    });

    it("resolves a profile by handle in any casing", async () => {
      const { handle, user } = await onboard();

      const response = await app.inject({ method: "GET", url: `/users/${handle.toUpperCase()}` });

      assert.equal(response.statusCode, 200);
      assert.equal(response.json().userId, user.userId);
    });

    it("refuses reserved handles", async () => {
      const { credentials } = await signIn();

      for (const handle of ["support", "admin", "settings"]) {
        const response = await app.inject({
          method: "POST",
          url: "/users",
          headers: authed(credentials.accessToken),
          payload: { handle, displayName: "Nope", dateOfBirth: ADULT },
        });

        assert.equal(response.statusCode, 400, handle);
      }
    });

    it("keeps identity across a handle change, and reserves the old one", async () => {
      const { credentials, handle, user } = await onboard();
      const replacement = uniqueHandle();

      const changed = await app.inject({
        method: "PUT",
        url: "/users/me/handle",
        headers: authed(credentials.accessToken),
        payload: { handle: replacement },
      });

      assert.equal(changed.statusCode, 200, changed.body);
      // The account is the same account: a handle is presentation.
      assert.equal(changed.json().userId, user.userId);
      assert.equal(changed.json().handle, replacement);

      // The old handle no longer resolves to anyone.
      const old = await app.inject({ method: "GET", url: `/users/${handle}` });
      assert.equal(old.statusCode, 404);

      // And nobody else may take it while it is in cooldown.
      const opportunist = await signIn();
      const claim = await app.inject({
        method: "POST",
        url: "/users",
        headers: authed(opportunist.credentials.accessToken),
        payload: { handle, displayName: "Impostor", dateOfBirth: ADULT },
      });

      assert.equal(claim.statusCode, 400);
    });

    it("lets someone take their own former handle back during its cooldown", async () => {
      const { credentials, handle } = await onboard();
      const temporary = uniqueHandle();

      await app.inject({
        method: "PUT",
        url: "/users/me/handle",
        headers: authed(credentials.accessToken),
        payload: { handle: temporary },
      });

      // The cooldown protects them from someone else, not from themselves.
      const back = await app.inject({
        method: "PUT",
        url: "/users/me/handle",
        headers: authed(credentials.accessToken),
        payload: { handle },
      });

      assert.equal(back.statusCode, 200, back.body);
      assert.equal(back.json().handle, handle);
    });
  });

  describe("profile and preferences", () => {
    it("updates a profile and clears a biography", async () => {
      const { credentials } = await onboard();

      const set = await app.inject({
        method: "PATCH",
        url: "/users/me",
        headers: authed(credentials.accessToken),
        payload: { displayName: "Renamed", biography: "Something" },
      });
      assert.equal(set.statusCode, 200, set.body);
      assert.equal(set.json().displayName, "Renamed");

      const cleared = await app.inject({
        method: "PATCH",
        url: "/users/me",
        headers: authed(credentials.accessToken),
        payload: { biography: null },
      });

      assert.equal(cleared.statusCode, 200);
      assert.equal(cleared.json().biography, null);
    });

    it("starts preferences at their documented defaults", async () => {
      const { user } = await onboard();

      // Autoplay with sound is the product's intended default; defaulting it
      // off here would quietly change the product.
      assert.deepEqual(user.preferences, {
        autoplayVideos: true,
        autoplaySound: true,
        locale: null,
        timeZone: null,
        reducedMotion: false,
      });
    });

    it("changes only the preferences named", async () => {
      const { credentials } = await onboard();

      const updated = await app.inject({
        method: "PUT",
        url: "/users/me/preferences",
        headers: authed(credentials.accessToken),
        payload: { autoplaySound: false, timeZone: "Europe/London" },
      });

      assert.equal(updated.statusCode, 200, updated.body);
      assert.equal(updated.json().preferences.autoplaySound, false);
      assert.equal(updated.json().preferences.timeZone, "Europe/London");
      // Untouched.
      assert.equal(updated.json().preferences.autoplayVideos, true);
      assert.equal(updated.json().preferences.reducedMotion, false);
    });
  });

  describe("public profiles", () => {
    it("exposes only what someone has chosen to present", async () => {
      const { handle, email } = await onboard();

      const response = await app.inject({ method: "GET", url: `/users/${handle}` });
      const body = response.json();

      assert.deepEqual(Object.keys(body).sort(), [
        "biography",
        "createdAt",
        "displayName",
        "handle",
        "userId",
      ]);
      // An email address is an authentication detail, not part of a profile.
      assert.ok(!JSON.stringify(body).includes(email));
      assert.equal(body.status, undefined);
      assert.equal(body.preferences, undefined);
    });

    it("reports an unknown handle as absent", async () => {
      const response = await app.inject({ method: "GET", url: `/users/${uniqueHandle()}` });

      assert.equal(response.statusCode, 404);
    });
  });

  describe("deactivation", () => {
    it("ends every session and hides the public profile", async () => {
      const { credentials, handle } = await onboard();

      const deactivated = await app.inject({
        method: "POST",
        url: "/users/me/deactivate",
        headers: authed(credentials.accessToken),
      });

      assert.equal(deactivated.statusCode, 200, deactivated.body);
      assert.ok(deactivated.json().sessionsRevoked >= 1);

      // Deactivating while leaving sessions alive would make the state
      // cosmetic.
      const stillSignedIn = await app.inject({
        method: "GET",
        url: "/users/me",
        headers: authed(credentials.accessToken),
      });
      assert.equal(stillSignedIn.statusCode, 401);

      const publicProfile = await app.inject({ method: "GET", url: `/users/${handle}` });
      assert.equal(publicProfile.statusCode, 404);
    });

    it("does not resurrect old sessions on reactivation", async () => {
      const { email, credentials, handle } = await onboard();

      await app.inject({
        method: "POST",
        url: "/users/me/deactivate",
        headers: authed(credentials.accessToken),
      });

      // Sign in again, which is what someone would actually do.
      await app.inject({ method: "POST", url: "/auth/magic-link", payload: { email } });
      const token = await readLinkFor(email);
      const session = await app.inject({
        method: "POST",
        url: "/auth/sessions",
        payload: { token },
      });
      assert.equal(session.statusCode, 201);

      const reactivated = await app.inject({
        method: "POST",
        url: "/users/me/reactivate",
        headers: authed(session.json().accessToken),
      });

      assert.equal(reactivated.statusCode, 200, reactivated.body);
      assert.equal(reactivated.json().status, "active");

      // The credentials revoked at deactivation stay revoked.
      const revoked = await app.inject({
        method: "GET",
        url: "/users/me",
        headers: authed(credentials.accessToken),
      });
      assert.equal(revoked.statusCode, 401);

      const publicProfile = await app.inject({ method: "GET", url: `/users/${handle}` });
      assert.equal(publicProfile.statusCode, 200);
    });
  });
});
