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
import { createReadyUpload } from "../../testing/fixtures.js";
import { LocationRepository } from "../locations/location.repository.js";
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
 * One property is asserted throughout and is the point of the sub-phase
 * arriving before visibility: **a Follow grants nothing**. Every Moment is
 * private to its author, and following somebody must not quietly change that.
 *
 * Requires `pnpm infra:up`.
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
  messaging: { brokers: ["localhost:9092"], clientId: "following-integration" },
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
            caption: "Mine alone, for now",
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
      // individual Moments", and every Moment is currently private to its
      // author. What a follower may see is decided in a later sub-phase, and
      // must be decided rather than arrived at.
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
});
