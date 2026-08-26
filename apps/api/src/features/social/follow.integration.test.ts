import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config/app-config.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { buildApp } from "../../server/app.js";
import { createTestAuthentication, type TestAuthentication } from "../../testing/authentication.js";
import { UserRepository } from "../users/user.repository.js";
import { UserService } from "../users/user.service.js";
import {
  createLocation,
  createReadyUpload,
  createRealWorldEvent,
} from "../../testing/fixtures.js";
import { LocationRepository } from "../locations/location.repository.js";
import { ModerationRepository } from "../moderation/moderation.repository.js";
import { MomentReactionRepository } from "../moments/moment-reaction.repository.js";
import { MomentRepository } from "../moments/moment.repository.js";
import { MomentService } from "../moments/moment.service.js";
import { RealWorldEventRepository } from "../real-world-events/real-world-event.repository.js";
import { UploadRepository } from "../uploads/upload.repository.js";
import { FollowRepository } from "./follow.repository.js";
import { FollowService } from "./follow.service.js";

/**
 * Following, end to end against real infrastructure.
 *
 * Driven through HTTP because the whole of this sub-phase is a surface: who may
 * follow whom, what happens when approval is required, and who may answer a
 * request. The rules that decide anything are pure and covered exhaustively
 * next door.
 *
 * One property is asserted throughout: **a Follow grants nothing**. The Moments
 * those tests use are private on purpose, so that what they prove is the rule
 * rather than whatever the default visibility happens to be.
 *
 * Requires `pnpm infra:up`.
 */

const MAILPIT = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? "8025"}`;

const config: AppConfig = {
  nodeEnv: "test",
  logLevel: "fatal",
  host: "127.0.0.1",
  port: 0,
  // Raised well above the production ceiling: this suite drives one process
  // through hundreds of requests in a minute, which is not the traffic the
  // limiter defends against.
  rateLimit: { maxPerMinute: 100_000 },
  database: {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? "5432"),
    database: process.env.POSTGRES_DATABASE ?? "chronologity",
    user: process.env.POSTGRES_USER ?? "chronologity",
    password: process.env.POSTGRES_PASSWORD ?? "chronologity",
  },
  messaging: { brokers: ["localhost:9092"], clientId: "following-integration" },
  outbox: { retentionMs: 0 },
  auth: {
    jwtSecret: new TextEncoder().encode("integration-test-secret-long-enough-for-hs256"),
    issuer: "chronologity",
    audience: "chronologity-clients",
    accessTokenTtlSeconds: 600,
    refreshTokenTtlSeconds: 2_592_000,
    magicLinkTtlSeconds: 900,
    phoneCodeTtlSeconds: 300,
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
    reverseEndpoint: "https://nominatim.openstreetmap.org/reverse",
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

describe("following", () => {
  let app: FastifyInstance;
  let database: Database;
  let authentication: TestAuthentication;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    authentication = createTestAuthentication(database.dataSource, config.auth, config.email);

    const accounts = new UserRepository(database.dataSource);


    app = await buildApp({
      config,
      dependencies: [],
      authentication,
      users: new UserService(database.dataSource, accounts, {
        minimumAgeYears: config.minimumAgeYears,
      }),
      follows: new FollowService(
        database.dataSource,
        new FollowRepository(database.dataSource),
        accounts,
        new RealWorldEventRepository(database.dataSource),
        new LocationRepository(database.dataSource),
        undefined,
        new MomentReactionRepository(database.dataSource),
      ),
      // Mounted so the property this whole sub-phase rests on can be asserted
      // rather than assumed: following somebody must not let you read their
      // Moments.
      moments: new MomentService(
        database.dataSource,
        new MomentRepository(database.dataSource),
        new UploadRepository(database.dataSource),
        new LocationRepository(database.dataSource),
        new RealWorldEventRepository(database.dataSource),
        new FollowRepository(database.dataSource),
        new UserRepository(database.dataSource),
        new ModerationRepository(database.dataSource),
      ),
    });
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

  /** Sign in for real, stopping before account creation. */
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

    return response.json();
  };

  /** Sign in and finish creating an account. */
  const onboard = async () => {
    const credentials = await signIn();
    const created = await app.inject({
      method: "POST",
      url: "/users",
      headers: authed(credentials.accessToken),
      payload: { handle: uniqueHandle(), displayName: "Test Person", dateOfBirth: ADULT },
    });

    assert.equal(created.statusCode, 201, created.body);

    return { ...credentials, userId: created.json().userId as string };
  };

  /** Turn on approval for an account, as its owner would in settings. */
  const requireApproval = async (userId: string): Promise<void> => {
    await database.dataSource.query(
      `UPDATE user_preferences SET requires_follow_approval = true WHERE user_id = $1`,
      [userId],
    );
  };

  const follow = async (accessToken: string, userId: string) =>
    app.inject({ method: "POST", url: `/users/${userId}/follow`, headers: authed(accessToken) });

  const pendingFor = async (accessToken: string) =>
    (await app.inject({ method: "GET", url: "/follow-requests", headers: authed(accessToken) }))
      .json().requests;

  describe("following an open account", () => {
    it("takes effect immediately", async () => {
      const follower = await onboard();
      const followed = await onboard();

      const response = await follow(follower.accessToken, followed.userId);

      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().outcome, "following");
      assert.equal(response.json().follow.user.userId, followed.userId);
    });

    it("appears in both people's lists, from their own side", async () => {
      const follower = await onboard();
      const followed = await onboard();

      await follow(follower.accessToken, followed.userId);

      const following = await app.inject({
        method: "GET",
        url: "/following",
        headers: authed(follower.accessToken),
      });
      const followers = await app.inject({
        method: "GET",
        url: "/followers",
        headers: authed(followed.accessToken),
      });

      assert.deepEqual(
        following.json().users.map((user: { userId: string }) => user.userId),
        [followed.userId],
      );
      assert.deepEqual(
        followers.json().users.map((user: { userId: string }) => user.userId),
        [follower.userId],
      );
    });

    it("treats following twice as the state already holding", async () => {
      const follower = await onboard();
      const followed = await onboard();

      await follow(follower.accessToken, followed.userId);
      const again = await follow(follower.accessToken, followed.userId);

      assert.equal(again.statusCode, 200, again.body);
      assert.equal(again.json().outcome, "following");

      const following = await app.inject({
        method: "GET",
        url: "/following",
        headers: authed(follower.accessToken),
      });
      assert.equal(following.json().users.length, 1);
    });

    it("is not reciprocal", async () => {
      const follower = await onboard();
      const followed = await onboard();

      await follow(follower.accessToken, followed.userId);

      // A following B says nothing about whether B follows A.
      const theirs = await app.inject({
        method: "GET",
        url: "/following",
        headers: authed(followed.accessToken),
      });
      assert.deepEqual(theirs.json().users, []);
    });
  });

  describe("following an account that requires approval", () => {
    it("opens a request rather than a follow", async () => {
      const asker = await onboard();
      const asked = await onboard();
      await requireApproval(asked.userId);

      const response = await follow(asker.accessToken, asked.userId);

      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().outcome, "requested");
      assert.equal(response.json().request.status, "pending");
      // Who is asking is what the person deciding needs to know.
      assert.equal(response.json().request.requester.userId, asker.userId);
    });

    it("opens no follow until it is accepted", async () => {
      const asker = await onboard();
      const asked = await onboard();
      await requireApproval(asked.userId);

      await follow(asker.accessToken, asked.userId);

      const following = await app.inject({
        method: "GET",
        url: "/following",
        headers: authed(asker.accessToken),
      });
      assert.deepEqual(following.json().users, []);
    });

    it("shows the request to the person asked", async () => {
      const asker = await onboard();
      const asked = await onboard();
      await requireApproval(asked.userId);

      await follow(asker.accessToken, asked.userId);

      const waiting = await pendingFor(asked.accessToken);
      assert.equal(waiting.length, 1);
      assert.equal(waiting[0].requester.userId, asker.userId);
    });

    it("opens only one request however many times somebody asks", async () => {
      const asker = await onboard();
      const asked = await onboard();
      await requireApproval(asked.userId);

      const first = await follow(asker.accessToken, asked.userId);
      const second = await follow(asker.accessToken, asked.userId);

      // Somebody tapping twice should see one request, not an error.
      assert.equal(second.statusCode, 200, second.body);
      assert.equal(second.json().request.requestId, first.json().request.requestId);
      assert.equal((await pendingFor(asked.accessToken)).length, 1);
    });

    it("creates the follow and settles the request together when accepted", async () => {
      const asker = await onboard();
      const asked = await onboard();
      await requireApproval(asked.userId);

      const requestId = (await follow(asker.accessToken, asked.userId)).json().request.requestId;

      const accepted = await app.inject({
        method: "POST",
        url: `/follow-requests/${requestId}/accept`,
        headers: authed(asked.accessToken),
      });

      assert.equal(accepted.statusCode, 204, accepted.body);

      const following = await app.inject({
        method: "GET",
        url: "/following",
        headers: authed(asker.accessToken),
      });
      assert.deepEqual(
        following.json().users.map((user: { userId: string }) => user.userId),
        [asked.userId],
      );
      assert.deepEqual(await pendingFor(asked.accessToken), []);
    });

    it("creates no follow when declined, and does not block", async () => {
      const asker = await onboard();
      const asked = await onboard();
      await requireApproval(asked.userId);

      const requestId = (await follow(asker.accessToken, asked.userId)).json().request.requestId;

      const declined = await app.inject({
        method: "POST",
        url: `/follow-requests/${requestId}/decline`,
        headers: authed(asked.accessToken),
      });

      assert.equal(declined.statusCode, 204, declined.body);

      const following = await app.inject({
        method: "GET",
        url: "/following",
        headers: authed(asker.accessToken),
      });
      assert.deepEqual(following.json().users, []);

      // Declining must not become a block. Asking again is permitted, and a
      // cooldown is a later product decision rather than a silent one taken
      // here.
      const again = await follow(asker.accessToken, asked.userId);
      assert.equal(again.statusCode, 200, again.body);
      assert.equal(again.json().outcome, "requested");
    });

    it("keeps every request, so a cooldown stays implementable", async () => {
      const asker = await onboard();
      const asked = await onboard();
      await requireApproval(asked.userId);

      const first = (await follow(asker.accessToken, asked.userId)).json().request.requestId;
      await app.inject({
        method: "POST",
        url: `/follow-requests/${first}/decline`,
        headers: authed(asked.accessToken),
      });
      await follow(asker.accessToken, asked.userId);

      const rows: { status: string }[] = await database.dataSource.query(
        `SELECT status FROM follow_requests
          WHERE requester_user_id = $1 AND requested_user_id = $2
          ORDER BY requested_at`,
        [asker.userId, asked.userId],
      );

      // Two rows, not one reused. What was refused survives, which is what the
      // specification means by the model supporting a cooldown.
      assert.deepEqual(
        rows.map((row) => row.status),
        ["declined", "pending"],
      );
    });

    it("lets the asker cancel", async () => {
      const asker = await onboard();
      const asked = await onboard();
      await requireApproval(asked.userId);

      const requestId = (await follow(asker.accessToken, asked.userId)).json().request.requestId;

      const cancelled = await app.inject({
        method: "DELETE",
        url: `/follow-requests/${requestId}`,
        headers: authed(asker.accessToken),
      });

      assert.equal(cancelled.statusCode, 204, cancelled.body);
      assert.deepEqual(await pendingFor(asked.accessToken), []);
    });
  });

  describe("ending a following relationship", () => {
    it("lets the follower stop following", async () => {
      const follower = await onboard();
      const followed = await onboard();
      await follow(follower.accessToken, followed.userId);

      const response = await app.inject({
        method: "DELETE",
        url: `/users/${followed.userId}/follow`,
        headers: authed(follower.accessToken),
      });

      assert.equal(response.statusCode, 204, response.body);
      const following = await app.inject({
        method: "GET",
        url: "/following",
        headers: authed(follower.accessToken),
      });
      assert.deepEqual(following.json().users, []);
    });

    it("lets the followed person remove a follower", async () => {
      const follower = await onboard();
      const followed = await onboard();
      await follow(follower.accessToken, followed.userId);

      const response = await app.inject({
        method: "DELETE",
        url: `/followers/${follower.userId}`,
        headers: authed(followed.accessToken),
      });

      assert.equal(response.statusCode, 204, response.body);
      const followers = await app.inject({
        method: "GET",
        url: "/followers",
        headers: authed(followed.accessToken),
      });
      assert.deepEqual(followers.json().users, []);
    });

    it("treats unfollowing somebody never followed as already done", async () => {
      const follower = await onboard();
      const stranger = await onboard();

      const response = await app.inject({
        method: "DELETE",
        url: `/users/${stranger.userId}/follow`,
        headers: authed(follower.accessToken),
      });

      assert.equal(response.statusCode, 204, response.body);
    });
  });

  describe("refusing what cannot be", () => {
    it("refuses following yourself", async () => {
      const person = await onboard();

      const response = await follow(person.accessToken, person.userId);

      assert.equal(response.statusCode, 400, response.body);
    });

    it("refuses following somebody who does not exist", async () => {
      const person = await onboard();

      const response = await follow(person.accessToken, randomUUID());

      assert.equal(response.statusCode, 404, response.body);
    });

    it("refuses answering a request addressed to somebody else", async () => {
      const asker = await onboard();
      const asked = await onboard();
      const stranger = await onboard();
      await requireApproval(asked.userId);

      const requestId = (await follow(asker.accessToken, asked.userId)).json().request.requestId;

      const response = await app.inject({
        method: "POST",
        url: `/follow-requests/${requestId}/accept`,
        headers: authed(stranger.accessToken),
      });

      // Reported as absent, so identifiers cannot be probed.
      assert.equal(response.statusCode, 404, response.body);
    });

    it("refuses the asker accepting their own request", async () => {
      const asker = await onboard();
      const asked = await onboard();
      await requireApproval(asked.userId);

      const requestId = (await follow(asker.accessToken, asked.userId)).json().request.requestId;

      const response = await app.inject({
        method: "POST",
        url: `/follow-requests/${requestId}/accept`,
        headers: authed(asker.accessToken),
      });

      assert.equal(response.statusCode, 404, response.body);
    });

    it("refuses answering one that has already been answered", async () => {
      const asker = await onboard();
      const asked = await onboard();
      await requireApproval(asked.userId);

      const requestId = (await follow(asker.accessToken, asked.userId)).json().request.requestId;
      await app.inject({
        method: "POST",
        url: `/follow-requests/${requestId}/accept`,
        headers: authed(asked.accessToken),
      });

      const again = await app.inject({
        method: "POST",
        url: `/follow-requests/${requestId}/decline`,
        headers: authed(asked.accessToken),
      });

      // Distinct from "no such request": the caller is entitled to it, and is
      // simply too late.
      assert.equal(again.statusCode, 400, again.body);
    });

    it("refuses a cursor it did not issue", async () => {
      const person = await onboard();

      const response = await app.inject({
        method: "GET",
        url: "/following?cursor=not-a-real-cursor",
        headers: authed(person.accessToken),
      });

      assert.equal(response.statusCode, 400, response.body);
    });

    it("refuses following without a caller", async () => {
      const response = await app.inject({ method: "POST", url: `/users/${randomUUID()}/follow` });

      assert.equal(response.statusCode, 401, response.body);
    });
  });

  describe("what a follow does not grant", () => {
    /** Somebody with an account and a Moment of their own. */
    const withAMoment = async () => {
      const credentials = await onboard();
      const uploadId = await createReadyUpload(database.dataSource, credentials.userId);
      const moment = (
        await app.inject({
          method: "POST",
          url: "/moments",
          headers: authed(credentials.accessToken),
          payload: {
            // Private on purpose. Now that a Moment can be public, a test that
            // took the default would be asserting the default rather than the
            // property: that a Follow changes nothing about what may be seen.
            visibility: "private",
            caption: "Mine alone",
            occurrence: {
              start: "1998-06-01T00:00:00.000Z",
              end: "1998-08-31T23:59:59.000Z",
              precision: "month",
            },
            occurrenceOffsetMinutes: 0,
            uploadIds: [uploadId],
          },
        })
      ).json();

      return { ...credentials, moment };
    };

    it("does not let a follower read what they follow", async () => {
      const followed = await withAMoment();
      const follower = await onboard();

      const followResponse = await follow(follower.accessToken, followed.userId);
      assert.equal(followResponse.json().outcome, "following");

      const read = await app.inject({
        method: "GET",
        url: `/moments/${followed.moment.momentId}`,
        headers: authed(follower.accessToken),
      });

      // The relationship exists and confers nothing. `social-graph.md:167`
      // requires that a Follow "must never bypass the visibility rules of
      // individual Moments": what a follower may see is decided by the Moment's
      // own audience, and following is not a way onto it.
      assert.equal(read.statusCode, 404, read.body);
    });

    it("does not put what they follow into their own listing", async () => {
      const followed = await withAMoment();
      const follower = await onboard();

      await follow(follower.accessToken, followed.userId);

      const listed = await app.inject({
        method: "GET",
        url: "/moments",
        headers: authed(follower.accessToken),
      });

      // Listing is still "my own history", not "history I can reach".
      assert.deepEqual(listed.json().moments, []);
    });

    it("does not grant anything once a request is accepted either", async () => {
      const followed = await withAMoment();
      const follower = await onboard();
      await requireApproval(followed.userId);

      const requestId = (await follow(follower.accessToken, followed.userId)).json().request
        .requestId;
      await app.inject({
        method: "POST",
        url: `/follow-requests/${requestId}/accept`,
        headers: authed(followed.accessToken),
      });

      const read = await app.inject({
        method: "GET",
        url: `/moments/${followed.moment.momentId}`,
        headers: authed(follower.accessToken),
      });

      // Approval is consent to be followed, not consent to be read. Those
      // become the same thing only when visibility gains a value that says so.
      assert.equal(read.statusCode, 404, read.body);
    });
  });

  describe("following a place and an occurrence", () => {
    const followEvent = async (accessToken: string, id: string) =>
      app.inject({
        method: "POST",
        url: `/real-world-events/${id}/follow`,
        headers: authed(accessToken),
      });

    const followPlace = async (accessToken: string, id: string) =>
      app.inject({ method: "POST", url: `/locations/${id}/follow`, headers: authed(accessToken) });

    const followedEvents = async (accessToken: string, query = "") =>
      app.inject({
        method: "GET",
        url: `/following/real-world-events${query}`,
        headers: authed(accessToken),
      });

    it("follows an occurrence immediately, with no request and no approval", async () => {
      const person = await onboard();
      const realWorldEventId = await createRealWorldEvent(database.dataSource, person.userId);

      const response = await followEvent(person.accessToken, realWorldEventId);

      // Nobody approves who watches shared history.
      assert.equal(response.statusCode, 204, response.body);
      assert.deepEqual(
        (await followedEvents(person.accessToken))
          .json()
          .realWorldEvents.map((event: { realWorldEventId: string }) => event.realWorldEventId),
        [realWorldEventId],
      );
    });

    it("follows a place immediately", async () => {
      const person = await onboard();
      const locationId = await createLocation(database.dataSource, person.userId);

      const response = await followPlace(person.accessToken, locationId);

      assert.equal(response.statusCode, 204, response.body);
      const listed = await app.inject({
        method: "GET",
        url: "/following/locations",
        headers: authed(person.accessToken),
      });
      assert.deepEqual(
        listed.json().locations.map((place: { locationId: string }) => place.locationId),
        [locationId],
      );
    });

    it("returns what is followed whole, not as identifiers", async () => {
      const person = await onboard();
      const realWorldEventId = await createRealWorldEvent(
        database.dataSource,
        person.userId,
        "Anime NYC 2026",
      );

      await followEvent(person.accessToken, realWorldEventId);

      const [event] = (await followedEvents(person.accessToken)).json().realWorldEvents;

      // A client listing what somebody follows should not need a round trip
      // per row to show it.
      assert.equal(event.name, "Anime NYC 2026");
      assert.ok(event.occurrence.start.length > 0);
    });

    it("treats following twice as the state already holding", async () => {
      const person = await onboard();
      const realWorldEventId = await createRealWorldEvent(database.dataSource, person.userId);

      await followEvent(person.accessToken, realWorldEventId);
      const again = await followEvent(person.accessToken, realWorldEventId);

      assert.equal(again.statusCode, 204, again.body);
      assert.equal(
        (await followedEvents(person.accessToken)).json().realWorldEvents.length,
        1,
      );
    });

    it("lets somebody follow an occurrence and a place recorded by anybody else", async () => {
      const recorder = await onboard();
      const follower = await onboard();
      const realWorldEventId = await createRealWorldEvent(database.dataSource, recorder.userId);
      const locationId = await createLocation(database.dataSource, recorder.userId);

      // Neither is owned. Their recorders hold provenance, not authority.
      assert.equal((await followEvent(follower.accessToken, realWorldEventId)).statusCode, 204);
      assert.equal((await followPlace(follower.accessToken, locationId)).statusCode, 204);
    });

    it("stops following, and treats stopping twice as already done", async () => {
      const person = await onboard();
      const realWorldEventId = await createRealWorldEvent(database.dataSource, person.userId);
      await followEvent(person.accessToken, realWorldEventId);

      const stopped = await app.inject({
        method: "DELETE",
        url: `/real-world-events/${realWorldEventId}/follow`,
        headers: authed(person.accessToken),
      });
      const again = await app.inject({
        method: "DELETE",
        url: `/real-world-events/${realWorldEventId}/follow`,
        headers: authed(person.accessToken),
      });

      assert.equal(stopped.statusCode, 204, stopped.body);
      assert.equal(again.statusCode, 204, again.body);
      assert.deepEqual((await followedEvents(person.accessToken)).json().realWorldEvents, []);
    });

    it("refuses following something that does not exist", async () => {
      const person = await onboard();

      assert.equal((await followEvent(person.accessToken, randomUUID())).statusCode, 404);
      assert.equal((await followPlace(person.accessToken, randomUUID())).statusCode, 404);
    });

    it("refuses removing an occurrence somebody still follows", async () => {
      const person = await onboard();
      const realWorldEventId = await createRealWorldEvent(database.dataSource, person.userId);
      await followEvent(person.accessToken, realWorldEventId);

      // RESTRICT: an occurrence people are watching should not vanish from
      // under them.
      await assert.rejects(
        database.dataSource.query(`DELETE FROM real_world_events WHERE real_world_event_id = $1`, [
          realWorldEventId,
        ]),
      );
    });

    it("grants no access to private moments about what is followed", async () => {
      const author = await onboard();
      const follower = await onboard();
      const realWorldEventId = await createRealWorldEvent(database.dataSource, author.userId);
      const uploadId = await createReadyUpload(database.dataSource, author.userId);

      const moment = (
        await app.inject({
          method: "POST",
          url: "/moments",
          headers: authed(author.accessToken),
          payload: {
            // Private on purpose: the property is that following a shared
            // context is not a way into a Moment the context happens to hold.
            visibility: "private",
            caption: "I was there",
            occurrence: {
              start: "2026-11-20T00:00:00.000Z",
              end: "2026-11-20T00:00:00.000Z",
              precision: "instant",
            },
            occurrenceOffsetMinutes: 0,
            uploadIds: [uploadId],
            realWorldEventIds: [realWorldEventId],
          },
        })
      ).json();

      await followEvent(follower.accessToken, realWorldEventId);

      const read = await app.inject({
        method: "GET",
        url: `/moments/${moment.momentId}`,
        headers: authed(follower.accessToken),
      });

      // Following an occurrence says what you want to hear about. It says
      // nothing about what you may see, and must not quietly start to.
      assert.equal(read.statusCode, 404, read.body);
    });

    it("refuses following without a caller", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/real-world-events/${randomUUID()}/follow`,
      });

      assert.equal(response.statusCode, 401, response.body);
    });
  });

  describe("paging when relationships share a moment", () => {
    it("returns every followed occurrence exactly once across pages", async () => {
      const person = await onboard();
      const ids: string[] = [];

      for (let index = 0; index < 5; index += 1) {
        const realWorldEventId = await createRealWorldEvent(database.dataSource, person.userId);
        ids.push(realWorldEventId);
        await app.inject({
          method: "POST",
          url: `/real-world-events/${realWorldEventId}/follow`,
          headers: authed(person.accessToken),
        });
      }

      // Force the tie the cursor has to survive: every relationship at one
      // instant. A cursor over the moment alone would loop or skip here.
      await database.dataSource.query(
        `UPDATE real_world_event_follows SET created_at = '2026-01-01T00:00:00Z'
          WHERE follower_user_id = $1`,
        [person.userId],
      );

      const seen: string[] = [];
      let cursor: string | undefined;

      do {
        const response = await app.inject({
          method: "GET",
          url: `/following/real-world-events?limit=2${cursor === undefined ? "" : `&cursor=${cursor}`}`,
          headers: authed(person.accessToken),
        });

        assert.equal(response.statusCode, 200, response.body);
        seen.push(
          ...response
            .json()
            .realWorldEvents.map((event: { realWorldEventId: string }) => event.realWorldEventId),
        );
        cursor = response.json().nextCursor;
      } while (cursor !== undefined);

      assert.equal(seen.length, 5, "a row was skipped or repeated");
      assert.deepEqual([...seen].sort(), [...ids].sort());
    });

    it("returns every followed person exactly once when follows share a moment", async () => {
      const follower = await onboard();
      const followed: string[] = [];

      for (let index = 0; index < 5; index += 1) {
        const other = await onboard();
        followed.push(other.userId);
        await app.inject({
          method: "POST",
          url: `/users/${other.userId}/follow`,
          headers: authed(follower.accessToken),
        });
      }

      // The tie 5I-1 could not survive, and the reason its cursor changed.
      await database.dataSource.query(
        `UPDATE user_follows SET created_at = '2026-01-01T00:00:00Z' WHERE follower_user_id = $1`,
        [follower.userId],
      );

      const seen: string[] = [];
      let cursor: string | undefined;

      do {
        const response = await app.inject({
          method: "GET",
          url: `/following?limit=2${cursor === undefined ? "" : `&cursor=${cursor}`}`,
          headers: authed(follower.accessToken),
        });

        seen.push(...response.json().users.map((user: { userId: string }) => user.userId));
        cursor = response.json().nextCursor;
      } while (cursor !== undefined);

      assert.equal(seen.length, 5, "a row was skipped or repeated");
      assert.deepEqual([...seen].sort(), [...followed].sort());
    });
  });

  describe("blocking", () => {
    const block = async (accessToken: string, userId: string) =>
      app.inject({ method: "POST", url: `/users/${userId}/block`, headers: authed(accessToken) });

    const unblock = async (accessToken: string, userId: string) =>
      app.inject({
        method: "DELETE",
        url: `/users/${userId}/block`,
        headers: authed(accessToken),
      });

    const followingOf = async (accessToken: string) =>
      (await app.inject({ method: "GET", url: "/following", headers: authed(accessToken) }))
        .json().users;

    it("ends the follow in both directions at once", async () => {
      const blocker = await onboard();
      const blocked = await onboard();
      await follow(blocker.accessToken, blocked.userId);
      await follow(blocked.accessToken, blocker.userId);

      const response = await block(blocker.accessToken, blocked.userId);

      assert.equal(response.statusCode, 204, response.body);
      // A block is stronger than unfollowing: it severs the relationship
      // whichever way it ran.
      assert.deepEqual(await followingOf(blocker.accessToken), []);
      assert.deepEqual(await followingOf(blocked.accessToken), []);
    });

    it("settles a pending request in either direction", async () => {
      const blocker = await onboard();
      const asker = await onboard();
      await requireApproval(blocker.userId);
      await follow(asker.accessToken, blocker.userId);

      await block(blocker.accessToken, asker.userId);

      assert.deepEqual(await pendingFor(blocker.accessToken), []);

      const rows: { status: string }[] = await database.dataSource.query(
        `SELECT status FROM follow_requests WHERE requester_user_id = $1`,
        [asker.userId],
      );
      // Cancelled rather than declined. A block is not an answer to the
      // question the request asked, and recording it as one would put a refusal
      // in the history that nobody gave.
      assert.deepEqual(rows.map((row) => row.status), ["cancelled"]);
    });

    it("hides the blocker exactly as an account that does not exist", async () => {
      const blocker = await onboard();
      const blocked = await onboard();
      await block(blocker.accessToken, blocked.userId);

      const asBlocked = await follow(blocked.accessToken, blocker.userId);
      const asMissing = await follow(blocked.accessToken, randomUUID());

      // Announcing a block is forbidden; inferring one from behaviour is not.
      // So the two answers must be indistinguishable.
      assert.equal(asBlocked.statusCode, 404, asBlocked.body);
      assert.equal(asMissing.statusCode, 404, asMissing.body);
      assert.equal(asBlocked.json().message, asMissing.json().message);
    });

    it("tells the blocker plainly when they try to follow whom they blocked", async () => {
      const blocker = await onboard();
      const blocked = await onboard();
      await block(blocker.accessToken, blocked.userId);

      const response = await follow(blocker.accessToken, blocked.userId);

      // They did the blocking and already know. A silence here would only
      // confuse.
      assert.equal(response.statusCode, 400, response.body);
      assert.match(response.json().message, /blocked/i);
    });

    it("stops a blocked person opening a request", async () => {
      const blocker = await onboard();
      const blocked = await onboard();
      await requireApproval(blocker.userId);
      await block(blocker.accessToken, blocked.userId);

      const response = await follow(blocked.accessToken, blocker.userId);

      assert.equal(response.statusCode, 404, response.body);
      assert.deepEqual(await pendingFor(blocker.accessToken), []);
    });

    it("restores nothing when the block is lifted", async () => {
      const blocker = await onboard();
      const blocked = await onboard();
      await follow(blocker.accessToken, blocked.userId);
      await follow(blocked.accessToken, blocker.userId);

      await block(blocker.accessToken, blocked.userId);
      const lifted = await unblock(blocker.accessToken, blocked.userId);

      assert.equal(lifted.statusCode, 204, lifted.body);
      // Unblocking removes the boundary. What it severed stays severed.
      assert.deepEqual(await followingOf(blocker.accessToken), []);
      assert.deepEqual(await followingOf(blocked.accessToken), []);
    });

    it("lets following work again from scratch after unblocking", async () => {
      const blocker = await onboard();
      const blocked = await onboard();
      await block(blocker.accessToken, blocked.userId);
      await unblock(blocker.accessToken, blocked.userId);

      const response = await follow(blocked.accessToken, blocker.userId);

      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().outcome, "following");
    });

    it("treats blocking twice as the state already holding", async () => {
      const blocker = await onboard();
      const blocked = await onboard();

      await block(blocker.accessToken, blocked.userId);
      const again = await block(blocker.accessToken, blocked.userId);

      assert.equal(again.statusCode, 204, again.body);

      const listed = await app.inject({
        method: "GET",
        url: "/blocks",
        headers: authed(blocker.accessToken),
      });
      assert.equal(listed.json().users.length, 1);
    });

    it("refuses blocking yourself", async () => {
      const person = await onboard();

      const response = await block(person.accessToken, person.userId);

      assert.equal(response.statusCode, 400, response.body);
    });

    it("refuses blocking somebody who does not exist", async () => {
      const person = await onboard();

      const response = await block(person.accessToken, randomUUID());

      assert.equal(response.statusCode, 404, response.body);
    });

    it("shows only who you blocked, never who blocked you", async () => {
      const blocker = await onboard();
      const blocked = await onboard();
      await block(blocker.accessToken, blocked.userId);

      const theirs = await app.inject({
        method: "GET",
        url: "/blocks",
        headers: authed(blocked.accessToken),
      });

      // There is no direction of this list that would tell somebody they have
      // been blocked, because there must not be.
      assert.deepEqual(theirs.json().users, []);
    });

    it("leaves what either person follows in the world alone", async () => {
      const blocker = await onboard();
      const blocked = await onboard();
      const realWorldEventId = await createRealWorldEvent(database.dataSource, blocker.userId);

      await app.inject({
        method: "POST",
        url: `/real-world-events/${realWorldEventId}/follow`,
        headers: authed(blocked.accessToken),
      });

      await block(blocker.accessToken, blocked.userId);

      const followed = await app.inject({
        method: "GET",
        url: "/following/real-world-events",
        headers: authed(blocked.accessToken),
      });

      // Blocking is about a person, not about what they are interested in.
      // Severing this would punish somebody for caring about shared history.
      assert.equal(followed.json().realWorldEvents.length, 1);
    });

    it("pages the block list without skipping a tie", async () => {
      const blocker = await onboard();
      const blocked: string[] = [];

      for (let index = 0; index < 5; index += 1) {
        const other = await onboard();
        blocked.push(other.userId);
        await block(blocker.accessToken, other.userId);
      }

      // Blocking several people in one sitting is exactly how this ties.
      await database.dataSource.query(
        `UPDATE user_blocks SET created_at = '2026-01-01T00:00:00Z' WHERE blocker_user_id = $1`,
        [blocker.userId],
      );

      const seen: string[] = [];
      let cursor: string | undefined;

      do {
        const response = await app.inject({
          method: "GET",
          url: `/blocks?limit=2${cursor === undefined ? "" : `&cursor=${cursor}`}`,
          headers: authed(blocker.accessToken),
        });

        assert.ok(response.json().users.length <= 2, "the limit was not honoured");
        seen.push(...response.json().users.map((user: { userId: string }) => user.userId));
        cursor = response.json().nextCursor;
      } while (cursor !== undefined);

      assert.equal(seen.length, 5, "a row was skipped or repeated");
      assert.deepEqual([...seen].sort(), [...blocked].sort());
    });

    it("refuses blocking without a caller", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/users/${randomUUID()}/block`,
      });

      assert.equal(response.statusCode, 401, response.body);
    });
  });
});
