import assert from "node:assert/strict";
import { testAppConfig } from "../../testing/app-config.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { buildApp } from "../../server/app.js";
import { createTestAuthentication, type TestAuthentication } from "../../testing/authentication.js";
import { UserRepository } from "./user.repository.js";
import { UserService } from "./user.service.js";

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

const config = testAppConfig("users-integration");

/** Old enough under any plausible minimum, and fixed so the tests do not age. */
const ADULT = "1990-04-12";

const uniqueEmail = () => `person-${randomUUID()}@example.test`;

/** Handles must be unique across the whole database, including earlier runs. */
const uniqueHandle = () => `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;

describe("users", () => {
  let app: FastifyInstance;
  let database: Database;
  let authentication: TestAuthentication;
  let users: UserService;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    authentication = createTestAuthentication(database.dataSource, config.auth, config.email);

    // No injected clock: nothing here manipulates time. The handle cooldown is
    // exercised by claiming during it, which needs no clock at all.
    users = new UserService(database.dataSource, new UserRepository(database.dataSource), {
      minimumAgeYears: config.minimumAgeYears,
    });

    app = await buildApp({ config, dependencies: [], authentication, users });
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
      const rows = await database.dataSource.query(
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

    it("keeps the date of birth out of anything that cannot be erased", async () => {
      // The hazard this guards moved rather than disappeared (ADR-095). It used
      // to be event history; it is now the outbox and the Kafka log behind it,
      // where published rows are never deleted and a topic's retention is not
      // an erasure mechanism. A birthdate in either could not be removed when
      // somebody asks for their data to be deleted.
      const { user } = await onboard();

      const rows: { payload: unknown; metadata: unknown }[] = await database.dataSource.query(
        `SELECT payload, metadata FROM outbox_messages WHERE aggregate_id = $1`,
        [user.userId],
      );

      const published = JSON.stringify(rows);

      assert.doesNotMatch(published, new RegExp(ADULT));
      assert.doesNotMatch(published, /dateOfBirth/);
    });

    it("records the threshold the account was admitted under", async () => {
      const { user } = await onboard();

      const rows: { minimum_age_at_creation: number }[] = await database.dataSource.query(
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
        // Open, as a Moment is public unless its author says otherwise. What
        // it governs is the walk through somebody's history, never whether any
        // Moment of it is visible.
        timelineIsPublic: true,
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
