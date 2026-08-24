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
import { UploadRepository } from "../uploads/upload.repository.js";
import { LocationRepository } from "../locations/location.repository.js";
import { RealWorldEventRepository } from "../real-world-events/real-world-event.repository.js";
import {
  createLocation,
  createPendingUpload,
  createReadyUpload,
  createRealWorldEvent,
} from "../../testing/fixtures.js";
import { FollowRepository } from "../social/follow.repository.js";
import { FollowService } from "../social/follow.service.js";
import { MomentRepository } from "./moment.repository.js";
import { withTransaction } from "../../lib/database/transaction.js";
import { MomentService } from "./moment.service.js";

/**
 * Moments, end to end against real infrastructure.
 *
 * Driven through HTTP, because what a Moment is only becomes true once it has
 * survived the round trip: the occurrence, its precision, and the offset that
 * gives it local meaning all have to come back as they went in. The rules that
 * decide anything are pure and covered exhaustively next door.
 *
 * Media is inserted at the state the decoder would have left it in. Running a
 * real file through ffmpeg here would test the upload lifecycle again rather
 * than anything about Moments.
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
  messaging: { brokers: ["localhost:9092"], clientId: "moments-integration" },
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

describe("moments", () => {
  let app: FastifyInstance;
  let database: Database;
  let authentication: TestAuthentication;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    authentication = createTestAuthentication(database.dataSource, config.auth, config.email);


    app = await buildApp({
      config,
      dependencies: [],
      authentication,
      users: new UserService(database.dataSource, new UserRepository(database.dataSource), {
        minimumAgeYears: config.minimumAgeYears,
      }),
      // Mounted because a Block is part of what decides visibility, and a test
      // that inserted the row by hand would prove the query rather than the
      // rule.
      follows: new FollowService(
        database.dataSource,
        new FollowRepository(database.dataSource),
        new UserRepository(database.dataSource),
        new RealWorldEventRepository(database.dataSource),
        new LocationRepository(database.dataSource),
      ),
      moments: new MomentService(
        database.dataSource,
        new MomentRepository(database.dataSource),
        new UploadRepository(database.dataSource),
        new LocationRepository(database.dataSource),
        new RealWorldEventRepository(database.dataSource),
        new FollowRepository(database.dataSource),
        new UserRepository(database.dataSource),
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

  /** Summer 1998, known to the month and no more precisely. */
  const summer = {
    start: "1998-06-01T00:00:00.000Z",
    end: "1998-08-31T23:59:59.000Z",
    precision: "month",
  } as const;

  /** New York in June: four hours behind UTC. */
  const NEW_YORK = -240;

  const record = async (accessToken: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/moments", headers: authed(accessToken), payload });

  /** Somebody with an account and a piece of usable media. */
  const someoneWithMedia = async () => {
    const credentials = await onboard();
    const uploadId = await createReadyUpload(database.dataSource, credentials.userId);

    return { ...credentials, uploadId };
  };

  describe("recording what happened", () => {
    it("keeps the occurrence, its precision, and the offset it was given", async () => {
      const { accessToken, uploadId } = await someoneWithMedia();

      const response = await record(accessToken, {
        caption: "The summer everything changed",
        occurrence: summer,
        occurrenceOffsetMinutes: NEW_YORK,
        uploadIds: [uploadId],
      });

      assert.equal(response.statusCode, 201, response.body);
      // Nothing invents a day for a summer nobody dated more precisely, and the
      // offset survives a timestamptz column that would otherwise discard it.
      assert.deepEqual(response.json().occurrence, summer);
      assert.equal(response.json().occurrenceOffsetMinutes, NEW_YORK);
    });

    it("places a moment where it happened, not when it was recorded", async () => {
      const { accessToken, uploadId } = await someoneWithMedia();
      const then = {
        start: "2014-06-12T19:30:00.000Z",
        end: "2014-06-12T19:30:00.000Z",
        precision: "instant",
      };

      const moment = (
        await record(accessToken, {
          caption: "The night of the match",
          occurrence: then,
          occurrenceOffsetMinutes: NEW_YORK,
          uploadIds: [uploadId],
        })
      ).json();

      assert.deepEqual(moment.occurrence, then);
      // Recorded now, positioned in 2014. Both are facts and the record keeps
      // them apart.
      assert.ok(Date.parse(moment.createdAt) > Date.parse(then.start));
    });

    it("returns its media in the order it was given", async () => {
      const credentials = await onboard();
      const first = await createReadyUpload(database.dataSource, credentials.userId);
      const second = await createReadyUpload(database.dataSource, credentials.userId, "video");
      const third = await createReadyUpload(database.dataSource, credentials.userId);

      const response = await record(credentials.accessToken, {
        caption: "Three ways of remembering it",
        occurrence: summer,
        occurrenceOffsetMinutes: 0,
        uploadIds: [third, first, second],
      });

      assert.equal(response.statusCode, 201, response.body);
      assert.deepEqual(
        response.json().media.map((upload: { uploadId: string }) => upload.uploadId),
        [third, first, second],
      );
    });

    it("accepts an occurrence in the future", async () => {
      const { accessToken, uploadId } = await someoneWithMedia();
      const later = "2099-01-01T00:00:00.000Z";

      const response = await record(accessToken, {
        caption: "Somebody's clock is wrong, or it is not",
        occurrence: { start: later, end: later, precision: "instant" },
        occurrenceOffsetMinutes: 0,
        uploadIds: [uploadId],
      });

      // Nothing refuses this. The specification says a future plan is not
      // *automatically* a Moment, which is softer than a prohibition.
      assert.equal(response.statusCode, 201, response.body);
    });
  });

  describe("refusing what cannot be a moment", () => {
    it("refuses one with no media", async () => {
      const credentials = await onboard();

      const response = await record(credentials.accessToken, {
        caption: "Just words",
        occurrence: summer,
        occurrenceOffsetMinutes: 0,
        uploadIds: [],
      });

      assert.equal(response.statusCode, 400, response.body);
    });

    it("refuses one with no caption", async () => {
      const { accessToken, uploadId } = await someoneWithMedia();

      const response = await record(accessToken, {
        occurrence: summer,
        occurrenceOffsetMinutes: 0,
        uploadIds: [uploadId],
      });

      assert.equal(response.statusCode, 400, response.body);
    });

    it("refuses a caption that is only whitespace", async () => {
      const { accessToken, uploadId } = await someoneWithMedia();

      const response = await record(accessToken, {
        caption: "   ",
        occurrence: summer,
        occurrenceOffsetMinutes: 0,
        uploadIds: [uploadId],
      });

      // Media and a timestamp alone are a photograph with a date on it.
      assert.equal(response.statusCode, 400, response.body);
    });

    it("refuses media that has not finished being checked", async () => {
      const credentials = await onboard();
      const pending = await createPendingUpload(database.dataSource, credentials.userId);

      const response = await record(credentials.accessToken, {
        caption: "Still transcoding",
        occurrence: summer,
        occurrenceOffsetMinutes: 0,
        uploadIds: [pending],
      });

      // A moment built on a file that might still fail would be one that could
      // not have been created.
      assert.equal(response.statusCode, 400, response.body);
    });

    it("refuses somebody else's media, exactly as media that does not exist", async () => {
      const mine = await onboard();
      const theirs = await someoneWithMedia();

      const asTheirs = await record(mine.accessToken, {
        caption: "Not mine to use",
        occurrence: summer,
        occurrenceOffsetMinutes: 0,
        uploadIds: [theirs.uploadId],
      });
      const asMissing = await record(mine.accessToken, {
        caption: "No such file",
        occurrence: summer,
        occurrenceOffsetMinutes: 0,
        uploadIds: [randomUUID()],
      });

      // Reported identically, so this cannot be used to discover which upload
      // identifiers are real.
      assert.equal(asTheirs.statusCode, 400, asTheirs.body);
      assert.equal(asMissing.statusCode, 400, asMissing.body);
      assert.equal(asTheirs.json().message, asMissing.json().message);
    });

    it("refuses the same file twice in one moment", async () => {
      const { accessToken, uploadId } = await someoneWithMedia();

      const response = await record(accessToken, {
        caption: "Seeing double",
        occurrence: summer,
        occurrenceOffsetMinutes: 0,
        uploadIds: [uploadId, uploadId],
      });

      // One file cannot occupy two positions in one order.
      assert.equal(response.statusCode, 400, response.body);
    });

    it("refuses an occurrence that ends before it starts", async () => {
      const { accessToken, uploadId } = await someoneWithMedia();

      const response = await record(accessToken, {
        caption: "Backwards",
        occurrence: {
          start: "2014-06-12T20:00:00.000Z",
          end: "2014-06-12T19:00:00.000Z",
          precision: "day",
        },
        occurrenceOffsetMinutes: 0,
        uploadIds: [uploadId],
      });

      assert.equal(response.statusCode, 400, response.body);
    });
  });

  describe("reading one back", () => {
    it("returns it whole, media and all", async () => {
      const { accessToken, uploadId } = await someoneWithMedia();
      const created = (
        await record(accessToken, {
          caption: "The summer everything changed",
          occurrence: summer,
          occurrenceOffsetMinutes: NEW_YORK,
          uploadIds: [uploadId],
        })
      ).json();

      const response = await app.inject({
        method: "GET",
        url: `/moments/${created.momentId}`,
        headers: authed(accessToken),
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), created);
    });

    it("hides somebody else's moment exactly as one that does not exist", async () => {
      const theirs = await someoneWithMedia();
      const mine = await onboard();

      const created = (
        await record(theirs.accessToken, {
          caption: "Not yours to read",
          occurrence: summer,
          occurrenceOffsetMinutes: 0,
          uploadIds: [theirs.uploadId],
          visibility: "private",
        })
      ).json();

      const asTheirs = await app.inject({
        method: "GET",
        url: `/moments/${created.momentId}`,
        headers: authed(mine.accessToken),
      });
      const asMissing = await app.inject({
        method: "GET",
        url: `/moments/${randomUUID()}`,
        headers: authed(mine.accessToken),
      });

      // Saying "this exists but is not yours" would itself disclose that
      // somebody recorded something, so a Moment somebody may not see reads
      // exactly as one that was never recorded.
      assert.equal(asTheirs.statusCode, 404, asTheirs.body);
      assert.equal(asMissing.statusCode, 404, asMissing.body);
      assert.equal(asTheirs.json().message, asMissing.json().message);
    });
  });

  describe("listing your own history", () => {
    /** Somebody with several Moments, at distinct times, newest last. */
    const withMoments = async (count: number) => {
      const credentials = await onboard();
      const created = [];

      for (let index = 0; index < count; index += 1) {
        const uploadId = await createReadyUpload(database.dataSource, credentials.userId);
        const at = new Date(Date.UTC(2000 + index, 0, 1)).toISOString();

        created.push(
          (
            await record(credentials.accessToken, {
              caption: `Moment ${index}`,
              occurrence: { start: at, end: at, precision: "instant" },
              occurrenceOffsetMinutes: 0,
              uploadIds: [uploadId],
            })
          ).json(),
        );
      }

      return { credentials, created };
    };

    it("returns the most recent occurrence first", async () => {
      const { credentials, created } = await withMoments(3);

      const response = await app.inject({
        method: "GET",
        url: "/moments",
        headers: authed(credentials.accessToken),
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(
        response.json().moments.map((moment: { momentId: string }) => moment.momentId),
        [...created].reverse().map((moment) => moment.momentId),
      );
    });

    it("shows nobody else's", async () => {
      // Somebody else's Moments exist and are not this caller's to see.
      await withMoments(2);
      const stranger = await onboard();

      const response = await app.inject({
        method: "GET",
        url: "/moments",
        headers: authed(stranger.accessToken),
      });

      assert.deepEqual(response.json().moments, []);
      assert.equal(response.json().nextCursor, undefined);
    });

    it("pages without repeating or skipping anything", async () => {
      const { credentials, created } = await withMoments(5);
      const seen: string[] = [];
      let cursor: string | undefined;

      do {
        const response = await app.inject({
          method: "GET",
          url: `/moments?limit=2${cursor === undefined ? "" : `&cursor=${cursor}`}`,
          headers: authed(credentials.accessToken),
        });

        assert.equal(response.statusCode, 200, response.body);
        seen.push(...response.json().moments.map((moment: { momentId: string }) => moment.momentId));
        cursor = response.json().nextCursor;
      } while (cursor !== undefined);

      // Every Moment exactly once, newest first, across three pages.
      assert.deepEqual(seen, [...created].reverse().map((moment) => moment.momentId));
      assert.equal(new Set(seen).size, 5);
    });

    it("keeps a stable order when two moments share an occurrence", async () => {
      const credentials = await onboard();
      const at = "2014-06-12T19:30:00.000Z";

      for (let index = 0; index < 4; index += 1) {
        const uploadId = await createReadyUpload(database.dataSource, credentials.userId);
        await record(credentials.accessToken, {
          caption: `Same instant ${index}`,
          occurrence: { start: at, end: at, precision: "instant" },
          occurrenceOffsetMinutes: 0,
          uploadIds: [uploadId],
        });
      }

      const read = async () =>
        (
          await app.inject({
            method: "GET",
            url: "/moments",
            headers: authed(credentials.accessToken),
          })
        )
          .json()
          .moments.map((moment: { momentId: string }) => moment.momentId);

      // The identifier settles the tie. It says nothing about which actually
      // happened first — only that the answer does not change between reads.
      assert.deepEqual(await read(), await read());
    });

    it("pages correctly even when every moment shares an occurrence", async () => {
      const credentials = await onboard();
      const at = "1999-12-31T23:59:59.000Z";

      for (let index = 0; index < 4; index += 1) {
        const uploadId = await createReadyUpload(database.dataSource, credentials.userId);
        await record(credentials.accessToken, {
          caption: `Tied ${index}`,
          occurrence: { start: at, end: at, precision: "instant" },
          occurrenceOffsetMinutes: 0,
          uploadIds: [uploadId],
        });
      }

      const seen: string[] = [];
      let cursor: string | undefined;

      do {
        const response = await app.inject({
          method: "GET",
          url: `/moments?limit=2${cursor === undefined ? "" : `&cursor=${cursor}`}`,
          headers: authed(credentials.accessToken),
        });

        seen.push(...response.json().moments.map((moment: { momentId: string }) => moment.momentId));
        cursor = response.json().nextCursor;
      } while (cursor !== undefined);

      // The case a cursor on occurrence alone would get wrong: it would either
      // loop forever or skip everything after the first page.
      assert.equal(seen.length, 4);
      assert.equal(new Set(seen).size, 4);
    });

    it("refuses a cursor it did not issue", async () => {
      const credentials = await onboard();

      const response = await app.inject({
        method: "GET",
        url: "/moments?cursor=not-a-real-cursor",
        headers: authed(credentials.accessToken),
      });

      // Ignoring it would silently return the first page again, to a caller
      // that believes it has already read it.
      assert.equal(response.statusCode, 400, response.body);
    });

    it("bounds how many one request may ask for", async () => {
      const credentials = await onboard();

      const response = await app.inject({
        method: "GET",
        url: "/moments?limit=500",
        headers: authed(credentials.accessToken),
      });

      assert.equal(response.statusCode, 400, response.body);
    });
  });

  describe("who may call these at all", () => {
    it("refuses recording without a caller", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/moments",
        // A body the schema accepts, so it is the missing caller that refuses
        // this rather than validation running first.
        payload: {
          caption: "Anonymous",
          occurrence: summer,
          occurrenceOffsetMinutes: 0,
          uploadIds: [randomUUID()],
        },
      });

      assert.equal(response.statusCode, 401, response.body);
    });

    it("refuses reading without a caller", async () => {
      const response = await app.inject({ method: "GET", url: `/moments/${randomUUID()}` });

      assert.equal(response.statusCode, 401, response.body);
    });

    it("refuses listing without a caller", async () => {
      const response = await app.inject({ method: "GET", url: "/moments" });

      assert.equal(response.statusCode, 401, response.body);
    });
  });

  describe("where it happened, and what it was part of", () => {
    it("records a place and several occurrences at creation, and returns them whole", async () => {
      const { accessToken, userId, uploadId } = await someoneWithMedia();
      const locationId = await createLocation(database.dataSource, userId);
      const wedding = await createRealWorldEvent(database.dataSource, userId, "A wedding");
      const reunion = await createRealWorldEvent(database.dataSource, userId, "A family reunion");

      const response = await record(accessToken, {
        caption: "The toast",
        occurrence: summer,
        occurrenceOffsetMinutes: 0,
        uploadIds: [uploadId],
        locationId,
        realWorldEventIds: [wedding, reunion],
      });

      assert.equal(response.statusCode, 201, response.body);

      // Whole, not by identifier: a client showing a Moment should not need
      // three more round trips to say where it was.
      assert.equal(response.json().place.location.locationId, locationId);
      assert.ok(response.json().place.location.name.length > 0);
      assert.deepEqual(
        response.json().realWorldEvents.map((event: { name: string }) => event.name),
        ["A family reunion", "A wedding"],
      );
    });

    it("records no place when nobody said where", async () => {
      const { accessToken, uploadId } = await someoneWithMedia();

      const response = await record(accessToken, {
        caption: "Somewhere, once",
        occurrence: summer,
        occurrenceOffsetMinutes: 0,
        uploadIds: [uploadId],
      });

      // Null rather than absent: "not known" is a fact about the history, and
      // distinct from a place that exists but is being withheld.
      assert.equal(response.json().place, null);
      assert.deepEqual(response.json().realWorldEvents, []);
    });

    it("replaces the place rather than accumulating them", async () => {
      const { accessToken, userId, uploadId } = await someoneWithMedia();
      const first = await createLocation(database.dataSource, userId);
      const corrected = await createLocation(database.dataSource, userId);

      const moment = (
        await record(accessToken, {
          caption: "Actually it was next door",
          occurrence: summer,
          occurrenceOffsetMinutes: 0,
          uploadIds: [uploadId],
          locationId: first,
        })
      ).json();

      const response = await app.inject({
        method: "PUT",
        url: `/moments/${moment.momentId}/location`,
        headers: authed(accessToken),
        payload: { locationId: corrected },
      });

      assert.equal(response.statusCode, 200, response.body);
      // A Moment has one place. Saying where twice is a correction, not a
      // second claim.
      assert.equal(response.json().place.location.locationId, corrected);
    });

    it("lets a place be taken back, leaving the moment intact", async () => {
      const { accessToken, userId, uploadId } = await someoneWithMedia();
      const locationId = await createLocation(database.dataSource, userId);

      const moment = (
        await record(accessToken, {
          caption: "On reflection nobody knows",
          occurrence: summer,
          occurrenceOffsetMinutes: 0,
          uploadIds: [uploadId],
          locationId,
        })
      ).json();

      const response = await app.inject({
        method: "DELETE",
        url: `/moments/${moment.momentId}/location`,
        headers: authed(accessToken),
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().place, null);
      // The Moment survives losing its place. Removing context is not removing
      // history.
      assert.equal(response.json().momentId, moment.momentId);
      assert.equal(response.json().media.length, 1);
    });

    it("treats removing a place a moment never had as already done", async () => {
      const { accessToken, uploadId } = await someoneWithMedia();
      const moment = (
        await record(accessToken, {
          caption: "Never had one",
          occurrence: summer,
          occurrenceOffsetMinutes: 0,
          uploadIds: [uploadId],
        })
      ).json();

      const response = await app.inject({
        method: "DELETE",
        url: `/moments/${moment.momentId}/location`,
        headers: authed(accessToken),
      });

      // The caller asked for a state that already holds, which is not an error.
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().place, null);
    });

    it("associates and dissociates an occurrence", async () => {
      const { accessToken, userId, uploadId } = await someoneWithMedia();
      const realWorldEventId = await createRealWorldEvent(database.dataSource, userId);

      const moment = (
        await record(accessToken, {
          caption: "Part of something larger",
          occurrence: summer,
          occurrenceOffsetMinutes: 0,
          uploadIds: [uploadId],
        })
      ).json();

      const added = await app.inject({
        method: "POST",
        url: `/moments/${moment.momentId}/real-world-events`,
        headers: authed(accessToken),
        payload: { realWorldEventId },
      });

      assert.equal(added.statusCode, 200, added.body);
      assert.equal(added.json().realWorldEvents.length, 1);

      const removed = await app.inject({
        method: "DELETE",
        url: `/moments/${moment.momentId}/real-world-events/${realWorldEventId}`,
        headers: authed(accessToken),
      });

      assert.equal(removed.statusCode, 200, removed.body);
      assert.deepEqual(removed.json().realWorldEvents, []);
    });

    it("treats the same occurrence twice as one association", async () => {
      const { accessToken, userId, uploadId } = await someoneWithMedia();
      const realWorldEventId = await createRealWorldEvent(database.dataSource, userId);

      const moment = (
        await record(accessToken, {
          caption: "Said twice",
          occurrence: summer,
          occurrenceOffsetMinutes: 0,
          uploadIds: [uploadId],
          realWorldEventIds: [realWorldEventId],
        })
      ).json();

      const again = await app.inject({
        method: "POST",
        url: `/moments/${moment.momentId}/real-world-events`,
        headers: authed(accessToken),
        payload: { realWorldEventId },
      });

      // The same claim made twice is one association.
      assert.equal(again.statusCode, 200, again.body);
      assert.equal(again.json().realWorldEvents.length, 1);
    });

    it("may point at somebody else's place and occurrence", async () => {
      const stranger = await onboard();
      const locationId = await createLocation(database.dataSource, stranger.userId);
      const realWorldEventId = await createRealWorldEvent(database.dataSource, stranger.userId);
      const mine = await someoneWithMedia();

      const response = await record(mine.accessToken, {
        caption: "Somebody else recorded the venue first",
        occurrence: summer,
        occurrenceOffsetMinutes: 0,
        uploadIds: [mine.uploadId],
        locationId,
        realWorldEventIds: [realWorldEventId],
      });

      // Neither is owned. A Location is shared reference data and an Event is
      // shared history — pointing at one somebody else recorded is the point.
      assert.equal(response.statusCode, 201, response.body);
      assert.equal(response.json().place.location.locationId, locationId);
    });
  });

  describe("refusing context that is not real", () => {
    it("refuses a place that does not exist rather than dropping it", async () => {
      const { accessToken, uploadId } = await someoneWithMedia();

      const response = await record(accessToken, {
        caption: "Nowhere",
        occurrence: summer,
        occurrenceOffsetMinutes: 0,
        uploadIds: [uploadId],
        locationId: randomUUID(),
      });

      // Silently discarding it would record a Moment claiming less than the
      // person said.
      assert.equal(response.statusCode, 400, response.body);
    });

    it("refuses an occurrence that does not exist", async () => {
      const { accessToken, uploadId } = await someoneWithMedia();

      const response = await record(accessToken, {
        caption: "Part of nothing",
        occurrence: summer,
        occurrenceOffsetMinutes: 0,
        uploadIds: [uploadId],
        realWorldEventIds: [randomUUID()],
      });

      assert.equal(response.statusCode, 400, response.body);
    });

    it("refuses to give context to somebody else's moment", async () => {
      const theirs = await someoneWithMedia();
      const mine = await onboard();
      const locationId = await createLocation(database.dataSource, mine.userId);

      const moment = (
        await record(theirs.accessToken, {
          caption: "Not yours to annotate",
          occurrence: summer,
          occurrenceOffsetMinutes: 0,
          uploadIds: [theirs.uploadId],
        })
      ).json();

      const response = await app.inject({
        method: "PUT",
        url: `/moments/${moment.momentId}/location`,
        headers: authed(mine.accessToken),
        payload: { locationId },
      });

      // Reported as absent, exactly as reading it would be.
      assert.equal(response.statusCode, 404, response.body);
    });

    it("refuses to remove a place a moment still points at", async () => {
      const { accessToken, userId, uploadId } = await someoneWithMedia();
      const locationId = await createLocation(database.dataSource, userId);

      await record(accessToken, {
        caption: "Anchored here",
        occurrence: summer,
        occurrenceOffsetMinutes: 0,
        uploadIds: [uploadId],
        locationId,
      });

      // RESTRICT, per ADR-097. A Location is shared reference data that
      // outlives any one Moment's use of it, and removing it should be refused
      // rather than quietly unpick somebody's history.
      await assert.rejects(
        database.dataSource.query(`DELETE FROM locations WHERE location_id = $1`, [locationId]),
      );
    });

    it("refuses association without a caller", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/moments/${randomUUID()}/location`,
        payload: { locationId: randomUUID() },
      });

      assert.equal(response.statusCode, 401, response.body);
    });
  });

  describe("correcting a moment", () => {
    /** How many edits of a kind a Moment has recorded. */
    const editsOf = async (momentId: string, kind?: string): Promise<number> => {
      const rows: { count: string }[] = await database.dataSource.query(
        kind === undefined
          ? `SELECT count(*) FROM moment_edits WHERE moment_id = $1`
          : `SELECT count(*) FROM moment_edits WHERE moment_id = $1 AND kind = $2`,
        kind === undefined ? [momentId] : [momentId, kind],
      );

      return Number(rows[0]?.count ?? "0");
    };

    /** A Moment with the given number of media, ready to be edited. */
    const editable = async (mediaCount = 1) => {
      const credentials = await onboard();
      const uploadIds: string[] = [];

      for (let index = 0; index < mediaCount; index += 1) {
        uploadIds.push(await createReadyUpload(database.dataSource, credentials.userId));
      }

      const moment = (
        await record(credentials.accessToken, {
          caption: "As first recorded",
          occurrence: summer,
          occurrenceOffsetMinutes: 0,
          uploadIds,
        })
      ).json();

      return { ...credentials, moment, uploadIds };
    };

    it("changes a caption without moving the moment in history", async () => {
      const { accessToken, moment } = await editable();

      const response = await app.inject({
        method: "PATCH",
        url: `/moments/${moment.momentId}`,
        headers: authed(accessToken),
        payload: { caption: "As it should have read" },
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().caption, "As it should have read");
      // Editing descriptive text must not move a Moment through chronological
      // navigation.
      assert.deepEqual(response.json().occurrence, moment.occurrence);
      assert.equal(await editsOf(moment.momentId, "caption_changed"), 1);
    });

    it("records what the caption used to be", async () => {
      const { accessToken, moment } = await editable();

      await app.inject({
        method: "PATCH",
        url: `/moments/${moment.momentId}`,
        headers: authed(accessToken),
        payload: { caption: "Corrected" },
      });

      const rows: { previous: { caption: string } }[] = await database.dataSource.query(
        `SELECT previous FROM moment_edits WHERE moment_id = $1 AND kind = 'caption_changed'`,
        [moment.momentId],
      );

      assert.equal(rows[0]?.previous.caption, "As first recorded");
    });

    it("moves a moment when its occurrence is corrected", async () => {
      const { accessToken, moment } = await editable();
      const corrected = {
        start: "2014-06-12T19:30:00.000Z",
        end: "2014-06-12T19:30:00.000Z",
        precision: "instant",
      };

      const response = await app.inject({
        method: "PUT",
        url: `/moments/${moment.momentId}/occurrence`,
        headers: authed(accessToken),
        payload: { occurrence: corrected, occurrenceOffsetMinutes: -240 },
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json().occurrence, corrected);
      assert.equal(response.json().occurrenceOffsetMinutes, -240);
      assert.equal(await editsOf(moment.momentId, "occurrence_corrected"), 1);
    });

    it("records where the moment used to sit in history", async () => {
      const { accessToken, moment } = await editable();

      await app.inject({
        method: "PUT",
        url: `/moments/${moment.momentId}/occurrence`,
        headers: authed(accessToken),
        payload: {
          occurrence: {
            start: "2014-06-12T19:30:00.000Z",
            end: "2014-06-12T19:30:00.000Z",
            precision: "instant",
          },
          occurrenceOffsetMinutes: 0,
        },
      });

      const rows: { previous: { occurrence: typeof summer } }[] = await database.dataSource.query(
        `SELECT previous FROM moment_edits WHERE moment_id = $1 AND kind = 'occurrence_corrected'`,
        [moment.momentId],
      );

      // Without this a correction leaves no trace of what it is a correction
      // to, and "represent corrections explicitly" means nothing.
      assert.deepEqual(rows[0]?.previous.occurrence, summer);
    });

    it("refuses a correction that is incoherent", async () => {
      const { accessToken, moment } = await editable();

      const response = await app.inject({
        method: "PUT",
        url: `/moments/${moment.momentId}/occurrence`,
        headers: authed(accessToken),
        payload: {
          occurrence: {
            start: "2014-06-12T20:00:00.000Z",
            end: "2014-06-12T19:00:00.000Z",
            precision: "day",
          },
          occurrenceOffsetMinutes: 0,
        },
      });

      assert.equal(response.statusCode, 400, response.body);
      // Nothing was recorded — though only because the refusal happens before
      // any write. The test below proves the stronger property.
      assert.equal(await editsOf(moment.momentId), 0);
    });

    it("keeps no record of an edit whose transaction failed", async () => {
      const { userId, moment } = await editable();
      const repository = new MomentRepository(database.dataSource);

      // The refusals above never reach a write, so they cannot show that a
      // change and its record commit together. This forces a failure after the
      // record is written and asserts it did not survive.
      await assert.rejects(
        withTransaction(database.dataSource, async (tx) => {
          await repository.updateCaption(tx, moment.momentId, "Half-written", new Date());
          await repository.recordEdit(tx, {
            momentId: moment.momentId,
            editedByUserId: userId,
            kind: "caption_changed",
            previous: { caption: moment.caption },
            at: new Date(),
          });

          throw new Error("something went wrong after both writes");
        }),
      );

      assert.equal(await editsOf(moment.momentId), 0, "a record outlived its transaction");

      const rows: { caption: string }[] = await database.dataSource.query(
        `SELECT caption FROM moments WHERE moment_id = $1`,
        [moment.momentId],
      );
      assert.equal(rows[0]?.caption, moment.caption, "the change outlived its transaction");
    });
  });

  describe("changing a moment's media", () => {
    const editsOf = async (momentId: string, kind: string): Promise<number> => {
      const rows: { count: string }[] = await database.dataSource.query(
        `SELECT count(*) FROM moment_edits WHERE moment_id = $1 AND kind = $2`,
        [momentId, kind],
      );

      return Number(rows[0]?.count ?? "0");
    };

    const editable = async (mediaCount = 1) => {
      const credentials = await onboard();
      const uploadIds: string[] = [];

      for (let index = 0; index < mediaCount; index += 1) {
        uploadIds.push(await createReadyUpload(database.dataSource, credentials.userId));
      }

      const moment = (
        await record(credentials.accessToken, {
          caption: "As first recorded",
          occurrence: summer,
          occurrenceOffsetMinutes: 0,
          uploadIds,
        })
      ).json();

      return { ...credentials, moment, uploadIds };
    };

    const mediaOf = (body: { media: { uploadId: string }[] }) =>
      body.media.map((upload) => upload.uploadId);

    it("appends added media without moving the moment", async () => {
      const { accessToken, userId, moment, uploadIds } = await editable(1);
      const extra = await createReadyUpload(database.dataSource, userId);

      const response = await app.inject({
        method: "POST",
        url: `/moments/${moment.momentId}/media`,
        headers: authed(accessToken),
        payload: { uploadIds: [extra] },
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(mediaOf(response.json()), [...uploadIds, extra]);
      // Adding media enriches the representation; it does not change when the
      // experience happened.
      assert.deepEqual(response.json().occurrence, moment.occurrence);
      assert.equal(await editsOf(moment.momentId, "media_added"), 1);
    });

    it("refuses media a moment already shows", async () => {
      const { accessToken, moment, uploadIds } = await editable(2);

      const response = await app.inject({
        method: "POST",
        url: `/moments/${moment.momentId}/media`,
        headers: authed(accessToken),
        payload: { uploadIds: [uploadIds[0]] },
      });

      assert.equal(response.statusCode, 400, response.body);
      assert.equal(await editsOf(moment.momentId, "media_added"), 0);
    });

    it("refuses media that is not ready", async () => {
      const { accessToken, userId, moment } = await editable(1);
      const pending = await createPendingUpload(database.dataSource, userId);

      const response = await app.inject({
        method: "POST",
        url: `/moments/${moment.momentId}/media`,
        headers: authed(accessToken),
        payload: { uploadIds: [pending] },
      });

      assert.equal(response.statusCode, 400, response.body);
    });

    it("renumbers what remains when media is removed", async () => {
      const { accessToken, moment, uploadIds } = await editable(3);

      const response = await app.inject({
        method: "DELETE",
        url: `/moments/${moment.momentId}/media/${uploadIds[1]}`,
        headers: authed(accessToken),
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(mediaOf(response.json()), [uploadIds[0], uploadIds[2]]);

      // Dense from zero: a gap would be a position nothing occupies.
      const rows: { position: number }[] = await database.dataSource.query(
        `SELECT position FROM moment_media WHERE moment_id = $1 ORDER BY position`,
        [moment.momentId],
      );
      assert.deepEqual(
        rows.map((row) => row.position),
        [0, 1],
      );
    });

    it("refuses to remove the last medium, and leaves the moment whole", async () => {
      const { accessToken, moment, uploadIds } = await editable(1);

      const response = await app.inject({
        method: "DELETE",
        url: `/moments/${moment.momentId}/media/${uploadIds[0]}`,
        headers: authed(accessToken),
      });

      // Media is mandatory, so this would leave a Moment that could not have
      // been created. Deleting a medium is not deleting the Moment.
      assert.equal(response.statusCode, 400, response.body);

      const after = await app.inject({
        method: "GET",
        url: `/moments/${moment.momentId}`,
        headers: authed(accessToken),
      });
      assert.equal(after.statusCode, 200, after.body);
      assert.equal(after.json().media.length, 1);
    });

    it("refuses to remove media the moment does not have", async () => {
      const { accessToken, moment } = await editable(2);

      const response = await app.inject({
        method: "DELETE",
        url: `/moments/${moment.momentId}/media/${randomUUID()}`,
        headers: authed(accessToken),
      });

      assert.equal(response.statusCode, 400, response.body);
    });

    it("reorders media without changing the set", async () => {
      const { accessToken, moment, uploadIds } = await editable(3);
      const reversed = [...uploadIds].reverse();

      const response = await app.inject({
        method: "PUT",
        url: `/moments/${moment.momentId}/media/order`,
        headers: authed(accessToken),
        payload: { uploadIds: reversed },
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(mediaOf(response.json()), reversed);
      // Presentation only: reordering never moves a Moment in chronology.
      assert.deepEqual(response.json().occurrence, moment.occurrence);
      assert.equal(await editsOf(moment.momentId, "media_reordered"), 1);
    });

    it("refuses a reorder that drops something", async () => {
      const { accessToken, moment, uploadIds } = await editable(2);

      const response = await app.inject({
        method: "PUT",
        url: `/moments/${moment.momentId}/media/order`,
        headers: authed(accessToken),
        payload: { uploadIds: [uploadIds[0]] },
      });

      assert.equal(response.statusCode, 400, response.body);
    });

    it("refuses a reorder that adds something", async () => {
      const { accessToken, userId, moment, uploadIds } = await editable(2);
      const extra = await createReadyUpload(database.dataSource, userId);

      const response = await app.inject({
        method: "PUT",
        url: `/moments/${moment.momentId}/media/order`,
        headers: authed(accessToken),
        payload: { uploadIds: [...uploadIds, extra] },
      });

      // An addition wearing the wrong name: it would skip the check that the
      // file is ready and belongs to the author.
      assert.equal(response.statusCode, 400, response.body);
    });
  });

  describe("taking a moment back", () => {
    const editable = async () => {
      const credentials = await onboard();
      const uploadId = await createReadyUpload(database.dataSource, credentials.userId);
      const moment = (
        await record(credentials.accessToken, {
          caption: "Recorded, then withdrawn",
          occurrence: summer,
          occurrenceOffsetMinutes: 0,
          uploadIds: [uploadId],
        })
      ).json();

      return { ...credentials, moment };
    };

    it("stops returning it, and stops listing it", async () => {
      const { accessToken, moment } = await editable();

      const deleted = await app.inject({
        method: "DELETE",
        url: `/moments/${moment.momentId}`,
        headers: authed(accessToken),
      });
      assert.equal(deleted.statusCode, 204, deleted.body);

      const read = await app.inject({
        method: "GET",
        url: `/moments/${moment.momentId}`,
        headers: authed(accessToken),
      });
      assert.equal(read.statusCode, 404, read.body);

      const listed = await app.inject({
        method: "GET",
        url: "/moments",
        headers: authed(accessToken),
      });
      assert.deepEqual(listed.json().moments, []);
    });

    it("keeps the row, because this is a tombstone rather than an erasure", async () => {
      const { accessToken, moment } = await editable();

      await app.inject({
        method: "DELETE",
        url: `/moments/${moment.momentId}`,
        headers: authed(accessToken),
      });

      const rows: { deleted_at: Date | null }[] = await database.dataSource.query(
        `SELECT deleted_at FROM moments WHERE moment_id = $1`,
        [moment.momentId],
      );

      assert.equal(rows.length, 1, "the row was removed rather than marked");
      assert.notEqual(rows[0]?.deleted_at, null);
    });

    it("refuses a second deletion, because it is already gone", async () => {
      const { accessToken, moment } = await editable();

      await app.inject({
        method: "DELETE",
        url: `/moments/${moment.momentId}`,
        headers: authed(accessToken),
      });
      const again = await app.inject({
        method: "DELETE",
        url: `/moments/${moment.momentId}`,
        headers: authed(accessToken),
      });

      // Reads no longer find it, so this is refused exactly as a Moment that
      // never existed would be.
      assert.equal(again.statusCode, 404, again.body);
    });
  });

  describe("who may change a moment", () => {
    it("refuses every edit to somebody else's moment", async () => {
      const theirs = await someoneWithMedia();
      const mine = await onboard();
      const moment = (
        await record(theirs.accessToken, {
          caption: "Not yours to correct",
          occurrence: summer,
          occurrenceOffsetMinutes: 0,
          uploadIds: [theirs.uploadId],
        })
      ).json();

      const attempts = [
        app.inject({
          method: "PATCH",
          url: `/moments/${moment.momentId}`,
          headers: authed(mine.accessToken),
          payload: { caption: "Mine now" },
        }),
        app.inject({
          method: "DELETE",
          url: `/moments/${moment.momentId}`,
          headers: authed(mine.accessToken),
        }),
        app.inject({
          method: "PUT",
          url: `/moments/${moment.momentId}/media/order`,
          headers: authed(mine.accessToken),
          payload: { uploadIds: [theirs.uploadId] },
        }),
      ];

      for (const attempt of await Promise.all(attempts)) {
        // Reported as absent, exactly as reading it would be.
        assert.equal(attempt.statusCode, 404, attempt.body);
      }
    });

    it("refuses editing without a caller", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/moments/${randomUUID()}`,
        payload: { caption: "Anonymous correction" },
      });

      assert.equal(response.statusCode, 401, response.body);
    });
  });

  describe("visibility", () => {
    /** Record a Moment at a chosen visibility and hand back its identifier. */
    const recordAt = async (
      person: { accessToken: string; userId: string },
      visibility: string,
      audience: string[] = [],
    ): Promise<string> => {
      const uploadId = await createReadyUpload(database.dataSource, person.userId);
      const created = await record(person.accessToken, {
        caption: "Something that happened",
        occurrence: summer,
        occurrenceOffsetMinutes: NEW_YORK,
        uploadIds: [uploadId],
        visibility: visibility === "restricted" ? "private" : visibility,
      });

      assert.equal(created.statusCode, 201, created.body);
      const momentId = created.json().momentId as string;

      if (visibility === "restricted") {
        const set = await app.inject({
          method: "PUT",
          url: `/moments/${momentId}/visibility`,
          headers: authed(person.accessToken),
          payload: { visibility: "restricted", audience },
        });
        assert.equal(set.statusCode, 200, set.body);
      }

      return momentId;
    };

    const readAs = async (accessToken: string, momentId: string) =>
      app.inject({ method: "GET", url: `/moments/${momentId}`, headers: authed(accessToken) });

    const historyOf = async (accessToken: string, authorUserId: string) =>
      app.inject({
        method: "GET",
        url: `/users/${authorUserId}/moments`,
        headers: authed(accessToken),
      });

    const block = async (accessToken: string, userId: string) =>
      app.inject({ method: "POST", url: `/users/${userId}/block`, headers: authed(accessToken) });

    it("lets a stranger read a public Moment", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const momentId = await recordAt(author, "public");

      const read = await readAs(stranger.accessToken, momentId);

      assert.equal(read.statusCode, 200, read.body);
      assert.equal(read.json().visibility, "public");
    });

    it("hides a private Moment exactly as one that does not exist", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const momentId = await recordAt(author, "private");

      const hidden = await readAs(stranger.accessToken, momentId);
      const missing = await readAs(stranger.accessToken, randomUUID());

      // That a Moment exists is itself a disclosure. The two answers must be
      // indistinguishable, not merely both refusals.
      assert.equal(hidden.statusCode, 404, hidden.body);
      assert.equal(missing.statusCode, 404, missing.body);
      assert.equal(hidden.json().message, missing.json().message);
    });

    it("lets somebody named on a restricted Moment read it", async () => {
      const author = await onboard();
      const guest = await onboard();
      const momentId = await recordAt(author, "restricted", [guest.userId]);

      const read = await readAs(guest.accessToken, momentId);

      assert.equal(read.statusCode, 200, read.body);
      assert.equal(read.json().visibility, "restricted");
    });

    it("refuses somebody left off a restricted Moment", async () => {
      const author = await onboard();
      const guest = await onboard();
      const stranger = await onboard();
      const momentId = await recordAt(author, "restricted", [guest.userId]);

      const read = await readAs(stranger.accessToken, momentId);

      assert.equal(read.statusCode, 404, read.body);
    });

    it("lets the author read their own whatever its visibility", async () => {
      const author = await onboard();

      for (const visibility of ["private", "restricted", "public"]) {
        const momentId = await recordAt(author, visibility);
        const read = await readAs(author.accessToken, momentId);

        assert.equal(read.statusCode, 200, `${visibility}: ${read.body}`);
      }
    });

    it("records a Moment as public when nobody says otherwise", async () => {
      const author = await onboard();
      const uploadId = await createReadyUpload(database.dataSource, author.userId);

      const created = await record(author.accessToken, {
        caption: "Something that happened",
        occurrence: summer,
        occurrenceOffsetMinutes: NEW_YORK,
        uploadIds: [uploadId],
      });

      assert.equal(created.json().visibility, "public");
    });

    it("records a Moment as private when its author says so while recording", async () => {
      const author = await onboard();
      const momentId = await recordAt(author, "private");

      const read = await readAs(author.accessToken, momentId);

      // Publishing first and correcting after is not good enough when the
      // default is public.
      assert.equal(read.json().visibility, "private");
    });

    it("leaves a Moment recorded before this shipped private", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const momentId = await recordAt(author, "public");

      // What the column held for every Moment recorded under the old promise.
      await database.dataSource.query(
        `UPDATE moments SET visibility = 'private' WHERE moment_id = $1`,
        [momentId],
      );

      const read = await readAs(stranger.accessToken, momentId);

      assert.equal(read.statusCode, 404, read.body);
    });

    it("keeps a blocked person out of a public Moment", async () => {
      const author = await onboard();
      const blocked = await onboard();
      const momentId = await recordAt(author, "public");
      await block(author.accessToken, blocked.userId);

      const read = await readAs(blocked.accessToken, momentId);

      // The requirement 5I-3 could only satisfy vacuously, there being no
      // access to survive a block at the time.
      assert.equal(read.statusCode, 404, read.body);
    });

    it("keeps the blocker out of the blocked person's public Moment too", async () => {
      const blocker = await onboard();
      const blocked = await onboard();
      const momentId = await recordAt(blocked, "public");
      await block(blocker.accessToken, blocked.userId);

      const read = await readAs(blocker.accessToken, momentId);

      // Both ways. An asymmetric rule would leave the blocker still reading the
      // history of somebody they wanted nothing to do with, and would let the
      // blocked person infer the block from access continuing one way only.
      assert.equal(read.statusCode, 404, read.body);
    });

    it("outlives an invitation issued before the block", async () => {
      const author = await onboard();
      const guest = await onboard();
      const momentId = await recordAt(author, "restricted", [guest.userId]);

      await block(author.accessToken, guest.userId);

      const read = await readAs(guest.accessToken, momentId);

      assert.equal(read.statusCode, 404, read.body);
    });

    it("still lets the author read their own after blocking somebody", async () => {
      const author = await onboard();
      const blocked = await onboard();
      const momentId = await recordAt(author, "private");
      await block(author.accessToken, blocked.userId);

      const read = await readAs(author.accessToken, momentId);

      // A block must never hide somebody's own history from them.
      assert.equal(read.statusCode, 200, read.body);
    });

    it("takes a Moment back out of sight the moment it is narrowed", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const momentId = await recordAt(author, "public");
      assert.equal((await readAs(stranger.accessToken, momentId)).statusCode, 200);

      await app.inject({
        method: "PUT",
        url: `/moments/${momentId}/visibility`,
        headers: authed(author.accessToken),
        payload: { visibility: "private" },
      });

      assert.equal((await readAs(stranger.accessToken, momentId)).statusCode, 404);
    });

    it("does not move a Moment through history when it is published", async () => {
      const author = await onboard();
      const momentId = await recordAt(author, "private");
      const before = (await readAs(author.accessToken, momentId)).json();

      await app.inject({
        method: "PUT",
        url: `/moments/${momentId}/visibility`,
        headers: authed(author.accessToken),
        payload: { visibility: "public" },
      });

      const after = (await readAs(author.accessToken, momentId)).json();

      // `privacy.md:102`: visibility must not affect historical position.
      assert.deepEqual(after.occurrence, before.occurrence);
      assert.equal(after.createdAt, before.createdAt);
    });

    it("clears the audience when a Moment stops being restricted", async () => {
      const author = await onboard();
      const guest = await onboard();
      const momentId = await recordAt(author, "restricted", [guest.userId]);

      await app.inject({
        method: "PUT",
        url: `/moments/${momentId}/visibility`,
        headers: authed(author.accessToken),
        payload: { visibility: "private" },
      });

      const audience = await app.inject({
        method: "GET",
        url: `/moments/${momentId}/audience`,
        headers: authed(author.accessToken),
      });

      // Leaving names behind would let a later change back to restricted
      // silently readmit people nobody had reconsidered.
      assert.deepEqual(audience.json().users, []);
    });

    it("refuses an audience on a Moment that is not restricted", async () => {
      const author = await onboard();
      const guest = await onboard();
      const momentId = await recordAt(author, "public");

      const set = await app.inject({
        method: "PUT",
        url: `/moments/${momentId}/visibility`,
        headers: authed(author.accessToken),
        payload: { visibility: "public", audience: [guest.userId] },
      });

      // Refused rather than ignored: it means the caller believes something
      // about the result that would not be true.
      assert.equal(set.statusCode, 400, set.body);
    });

    it("refuses an audience naming somebody who does not exist", async () => {
      const author = await onboard();
      const momentId = await recordAt(author, "public");

      const set = await app.inject({
        method: "PUT",
        url: `/moments/${momentId}/visibility`,
        headers: authed(author.accessToken),
        payload: { visibility: "restricted", audience: [randomUUID()] },
      });

      assert.equal(set.statusCode, 400, set.body);
    });

    it("refuses an author naming themselves in their own audience", async () => {
      const author = await onboard();
      const momentId = await recordAt(author, "public");

      const set = await app.inject({
        method: "PUT",
        url: `/moments/${momentId}/visibility`,
        headers: authed(author.accessToken),
        payload: { visibility: "restricted", audience: [author.userId] },
      });

      // Their own history is already theirs. Accepting it would put a row in
      // the list that no rule consults, and suggest their access depended on it.
      assert.equal(set.statusCode, 400, set.body);
    });

    it("ignores the same person named twice", async () => {
      const author = await onboard();
      const guest = await onboard();
      const momentId = await recordAt(author, "public");

      await app.inject({
        method: "PUT",
        url: `/moments/${momentId}/visibility`,
        headers: authed(author.accessToken),
        payload: { visibility: "restricted", audience: [guest.userId, guest.userId] },
      });

      const audience = await app.inject({
        method: "GET",
        url: `/moments/${momentId}/audience`,
        headers: authed(author.accessToken),
      });

      assert.equal(audience.json().users.length, 1);
    });

    it("refuses an audience larger than the bound", async () => {
      const author = await onboard();
      const momentId = await recordAt(author, "public");

      const set = await app.inject({
        method: "PUT",
        url: `/moments/${momentId}/visibility`,
        headers: authed(author.accessToken),
        payload: {
          visibility: "restricted",
          audience: Array.from({ length: 101 }, () => randomUUID()),
        },
      });

      assert.equal(set.statusCode, 400, set.body);
    });

    it("refuses a Viewer setting somebody else's visibility", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const momentId = await recordAt(author, "public");

      const set = await app.inject({
        method: "PUT",
        url: `/moments/${momentId}/visibility`,
        headers: authed(stranger.accessToken),
        payload: { visibility: "private" },
      });

      assert.equal(set.statusCode, 404, set.body);
    });

    it("refuses a Viewer reading somebody else's audience", async () => {
      const author = await onboard();
      const guest = await onboard();
      const momentId = await recordAt(author, "restricted", [guest.userId]);

      const read = await app.inject({
        method: "GET",
        url: `/moments/${momentId}/audience`,
        headers: authed(guest.accessToken),
      });

      // Being on a list does not entitle somebody to read it. Who else was
      // trusted is the author's business.
      assert.equal(read.statusCode, 404, read.body);
    });

    it("shows a stranger only the public part of somebody's history", async () => {
      const author = await onboard();
      const guest = await onboard();
      const stranger = await onboard();
      await recordAt(author, "public");
      await recordAt(author, "private");
      await recordAt(author, "restricted", [guest.userId]);

      const asStranger = await historyOf(stranger.accessToken, author.userId);
      const asGuest = await historyOf(guest.accessToken, author.userId);
      const asAuthor = await historyOf(author.accessToken, author.userId);

      assert.equal(asStranger.json().moments.length, 1);
      assert.equal(asGuest.json().moments.length, 2);
      assert.equal(asAuthor.json().moments.length, 3);
    });

    it("agrees with the single read for every combination", async () => {
      const author = await onboard();
      const guest = await onboard();
      const viewers = [author, guest, await onboard()];
      const recorded: string[] = [];

      for (const visibility of ["private", "restricted", "public"]) {
        recorded.push(await recordAt(author, visibility, [guest.userId]));
      }

      // The list filters in SQL and the single read applies the policy in
      // TypeScript. They state the same rule twice, so they are held against
      // each other rather than trusted separately.
      for (const viewer of viewers) {
        const listed = new Set<string>(
          (await historyOf(viewer.accessToken, author.userId))
            .json()
            .moments.map((moment: { momentId: string }) => moment.momentId),
        );

        for (const momentId of recorded) {
          const readable = (await readAs(viewer.accessToken, momentId)).statusCode === 200;

          assert.equal(
            listed.has(momentId),
            readable,
            `${momentId} listed=${listed.has(momentId)} readable=${readable}`,
          );
        }
      }
    });

    it("hides a blocked person's history entirely", async () => {
      const author = await onboard();
      const blocked = await onboard();
      await recordAt(author, "public");
      await block(author.accessToken, blocked.userId);

      const history = await historyOf(blocked.accessToken, author.userId);

      assert.deepEqual(history.json().moments, []);
    });

    it("pages somebody else's history without skipping a tie", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const recorded: string[] = [];

      for (let index = 0; index < 5; index += 1) {
        recorded.push(await recordAt(author, "public"));
      }

      // Every Moment at one instant, which is ordinary for a day somebody
      // backfills.
      await database.dataSource.query(
        `UPDATE moments SET occurrence_start = '1998-06-01T00:00:00Z' WHERE author_user_id = $1`,
        [author.userId],
      );

      const seen: string[] = [];
      let cursor: string | undefined;

      do {
        const response = await app.inject({
          method: "GET",
          url: `/users/${author.userId}/moments?limit=2${
            cursor === undefined ? "" : `&cursor=${cursor}`
          }`,
          headers: authed(stranger.accessToken),
        });

        assert.ok(response.json().moments.length <= 2, "the limit was not honoured");
        seen.push(...response.json().moments.map((moment: { momentId: string }) => moment.momentId));
        cursor = response.json().nextCursor;
      } while (cursor !== undefined);

      assert.equal(seen.length, 5, "a Moment was skipped or repeated");
      assert.deepEqual([...seen].sort(), [...recorded].sort());
    });

    it("returns full pages rather than pages thinned after the fact", async () => {
      const author = await onboard();
      const stranger = await onboard();
      await recordAt(author, "private");
      await recordAt(author, "public");
      await recordAt(author, "private");
      await recordAt(author, "public");

      const page = await app.inject({
        method: "GET",
        url: `/users/${author.userId}/moments?limit=2`,
        headers: authed(stranger.accessToken),
      });

      // Filtering after the query would have returned one or two here by luck
      // of the ordering, and stepped the cursor over what it dropped.
      assert.equal(page.json().moments.length, 2);
    });

    it("lets a Viewer change nothing about a Moment they can see", async () => {
      const author = await onboard();
      const viewer = await onboard();
      const momentId = await recordAt(author, "public");
      const uploadId = await createReadyUpload(database.dataSource, viewer.userId);
      const locationId = await createLocation(database.dataSource, author.userId);
      const realWorldEventId = await createRealWorldEvent(database.dataSource, author.userId);

      // Every way a Moment can be changed. Seeing something must never be
      // enough to rewrite it, and the single check that proves authorship is
      // deliberately not the one that decides who may look.
      const changes: {
        method: "PATCH" | "PUT" | "POST" | "DELETE";
        url: string;
        payload?: object;
      }[] = [
        { method: "PATCH", url: `/moments/${momentId}`, payload: { caption: "Rewritten" } },
        {
          method: "PUT",
          url: `/moments/${momentId}/occurrence`,
          payload: { occurrence: summer, occurrenceOffsetMinutes: 0 },
        },
        { method: "POST", url: `/moments/${momentId}/media`, payload: { uploadIds: [uploadId] } },
        {
          method: "PUT",
          url: `/moments/${momentId}/media/order`,
          payload: { uploadIds: [uploadId] },
        },
        { method: "DELETE", url: `/moments/${momentId}/media/${uploadId}` },
        { method: "PUT", url: `/moments/${momentId}/location`, payload: { locationId } },
        { method: "DELETE", url: `/moments/${momentId}/location` },
        {
          method: "POST",
          url: `/moments/${momentId}/real-world-events`,
          payload: { realWorldEventId },
        },
        { method: "DELETE", url: `/moments/${momentId}/real-world-events/${realWorldEventId}` },
        {
          method: "PUT",
          url: `/moments/${momentId}/visibility`,
          payload: { visibility: "private" },
        },
        { method: "DELETE", url: `/moments/${momentId}` },
      ];

      for (const change of changes) {
        const response = await app.inject({
          method: change.method,
          url: change.url,
          headers: authed(viewer.accessToken),
          ...(change.payload === undefined ? {} : { payload: change.payload }),
        });

        assert.equal(
          response.statusCode,
          404,
          `${change.method} ${change.url} answered ${response.statusCode}`,
        );
      }

      // And the Moment is exactly as its author left it.
      const after = await readAs(author.accessToken, momentId);
      assert.equal(after.json().caption, "Something that happened");
      assert.equal(after.json().visibility, "public");
    });

    it("refuses reading a Moment without a caller", async () => {
      const author = await onboard();
      const momentId = await recordAt(author, "public");

      const read = await app.inject({ method: "GET", url: `/moments/${momentId}` });

      // Public means public to a Viewer, not to the world. It is what lets a
      // block bite: signing out must not route around it.
      assert.equal(read.statusCode, 401, read.body);
    });

    it("refuses reading somebody's history without a caller", async () => {
      const author = await onboard();

      const history = await app.inject({ method: "GET", url: `/users/${author.userId}/moments` });

      assert.equal(history.statusCode, 401, history.body);
    });
  });

  describe("how much of a place other people are told", () => {
    /** Record a public Moment somewhere, at a chosen disclosure. */
    const recordSomewhere = async (
      author: { accessToken: string; userId: string },
      disclosure?: string,
    ): Promise<string> => {
      const uploadId = await createReadyUpload(database.dataSource, author.userId);
      const locationId = await createLocation(database.dataSource, author.userId);
      const created = await record(author.accessToken, {
        caption: "Something that happened",
        occurrence: summer,
        occurrenceOffsetMinutes: NEW_YORK,
        uploadIds: [uploadId],
        locationId,
        ...(disclosure === undefined ? {} : { locationDisclosure: disclosure }),
      });

      assert.equal(created.statusCode, 201, created.body);

      return created.json().momentId as string;
    };

    const placeSeenBy = async (accessToken: string, momentId: string) => {
      const read = await app.inject({
        method: "GET",
        url: `/moments/${momentId}`,
        headers: authed(accessToken),
      });

      assert.equal(read.statusCode, 200, read.body);

      return read.json().place;
    };

    const narrow = async (accessToken: string, momentId: string, disclosure: string) =>
      app.inject({
        method: "PUT",
        url: `/moments/${momentId}/location/disclosure`,
        headers: authed(accessToken),
        payload: { disclosure },
      });

    it("gives the author the exact place whatever they chose for others", async () => {
      const author = await onboard();

      for (const disclosure of ["exact", "neighbourhood", "city", "hidden"]) {
        const momentId = await recordSomewhere(author, disclosure);
        const place = await placeSeenBy(author.accessToken, momentId);

        assert.equal(place.disclosure, "exact", disclosure);
        assert.notEqual(place.location, null, disclosure);
      }
    });

    it("gives a stranger the exact place when nobody said otherwise", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const momentId = await recordSomewhere(author);

      const place = await placeSeenBy(stranger.accessToken, momentId);

      assert.equal(place.disclosure, "exact");
      assert.notEqual(place.location, null);
    });

    it("gives a stranger a neighbourhood and no place", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const momentId = await recordSomewhere(author, "neighbourhood");

      const place = await placeSeenBy(stranger.accessToken, momentId);

      assert.equal(place.disclosure, "neighbourhood");
      assert.equal(place.location, null);
      assert.equal(place.area.neighbourhood, "Midtown");
      assert.equal(place.area.city, "New York City");
    });

    it("withholds the neighbourhood at city level", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const momentId = await recordSomewhere(author, "city");

      const place = await placeSeenBy(stranger.accessToken, momentId);

      assert.equal(place.disclosure, "city");
      assert.equal(place.area.neighbourhood, null);
      assert.equal(place.area.city, "New York City");
      assert.equal(place.area.country, "United States");
    });

    it("still shows the Moment when its place is hidden", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const momentId = await recordSomewhere(author, "hidden");

      const place = await placeSeenBy(stranger.accessToken, momentId);

      // Hiding where is not hiding what. `locations.md:830`: "Can view Moment ≠
      // Can view exact Location".
      assert.equal(place.disclosure, "hidden");
      assert.equal(place.location, null);
      assert.equal(place.area, null);
    });

    it("hands out no identifier below exact, so nothing can be looked up", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const exact = await placeSeenBy(
        author.accessToken,
        await recordSomewhere(author, "exact"),
      );

      for (const disclosure of ["neighbourhood", "city", "hidden"]) {
        const momentId = await recordSomewhere(author, disclosure);
        const place = await placeSeenBy(stranger.accessToken, momentId);

        // The whole reason a reduced place is safe. An identifier would let
        // anybody read the exact place straight back through
        // `GET /locations/:locationId`, which serves any signed-in caller.
        assert.equal(
          JSON.stringify(place).includes("locationId"),
          false,
          `${disclosure} carried an identifier`,
        );
      }

      assert.ok(JSON.stringify(exact).includes("locationId"), "exact should carry one");
    });

    it("hands out no coordinates below exact", async () => {
      const author = await onboard();
      const stranger = await onboard();

      for (const disclosure of ["neighbourhood", "city", "hidden"]) {
        const momentId = await recordSomewhere(author, disclosure);
        const place = await placeSeenBy(stranger.accessToken, momentId);

        assert.equal(JSON.stringify(place).includes("40.75"), false, disclosure);
      }
    });

    it("takes effect on the next read when narrowed", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const momentId = await recordSomewhere(author);
      assert.equal((await placeSeenBy(stranger.accessToken, momentId)).disclosure, "exact");

      const narrowed = await narrow(author.accessToken, momentId, "city");

      assert.equal(narrowed.statusCode, 200, narrowed.body);
      assert.equal((await placeSeenBy(stranger.accessToken, momentId)).disclosure, "city");
    });

    it("survives the Moment being moved to a different place", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const momentId = await recordSomewhere(author, "city");
      const elsewhere = await createLocation(database.dataSource, author.userId);

      await app.inject({
        method: "PUT",
        url: `/moments/${momentId}/location`,
        headers: authed(author.accessToken),
        payload: { locationId: elsewhere },
      });

      // Moving a Moment to a different venue is not a decision to publish it.
      assert.equal((await placeSeenBy(stranger.accessToken, momentId)).disclosure, "city");
    });

    it("says no place at all when the Moment has none", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const uploadId = await createReadyUpload(database.dataSource, author.userId);
      const created = await record(author.accessToken, {
        caption: "Somewhere unrecorded",
        occurrence: summer,
        occurrenceOffsetMinutes: NEW_YORK,
        uploadIds: [uploadId],
        locationDisclosure: "hidden",
      });

      const place = await placeSeenBy(stranger.accessToken, created.json().momentId);

      // Null, not a hidden disclosure. "Nobody said where" and "you are not
      // being told where" are different facts.
      assert.equal(place, null);
    });

    it("reduces the same way when reading somebody's whole history", async () => {
      const author = await onboard();
      const stranger = await onboard();
      await recordSomewhere(author, "city");

      const history = await app.inject({
        method: "GET",
        url: `/users/${author.userId}/moments`,
        headers: authed(stranger.accessToken),
      });

      // The path most easily missed: reducing one Moment and forgetting the
      // list would leak every place a person ever recorded.
      const [only] = history.json().moments;
      assert.equal(only.place.disclosure, "city");
      assert.equal(only.place.location, null);
    });

    it("gives the author their own history exactly, through the same route", async () => {
      const author = await onboard();
      await recordSomewhere(author, "hidden");

      const history = await app.inject({
        method: "GET",
        url: `/users/${author.userId}/moments`,
        headers: authed(author.accessToken),
      });

      const [only] = history.json().moments;
      assert.equal(only.place.disclosure, "exact");
    });

    it("gives the author their own list exactly", async () => {
      const author = await onboard();
      await recordSomewhere(author, "hidden");

      const listed = await app.inject({
        method: "GET",
        url: "/moments",
        headers: authed(author.accessToken),
      });

      const [only] = listed.json().moments;
      assert.equal(only.place.disclosure, "exact");
    });

    it("refuses a Viewer changing somebody else's disclosure", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const momentId = await recordSomewhere(author, "exact");

      const attempt = await narrow(stranger.accessToken, momentId, "hidden");

      assert.equal(attempt.statusCode, 404, attempt.body);
      assert.equal((await placeSeenBy(author.accessToken, momentId)).disclosure, "exact");
    });

    it("refuses a disclosure that is not one of the four", async () => {
      const author = await onboard();
      const momentId = await recordSomewhere(author);

      const attempt = await narrow(author.accessToken, momentId, "vaguely");

      assert.equal(attempt.statusCode, 400, attempt.body);
    });

    it("keeps precision and disclosure independent", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const momentId = await recordSomewhere(author, "exact");
      // Broad rather than exact: somewhere known only as a wide area, which the
      // position constraint permits so long as it still has a position.
      await database.dataSource.query(
        `UPDATE locations SET precision = 'broad' WHERE recorded_by_user_id = $1`,
        [author.userId],
      );

      const place = await placeSeenBy(stranger.accessToken, momentId);

      // Precision says how well anybody knows where this happened; disclosure
      // says how much of that a Viewer receives. A place known only vaguely,
      // disclosed fully, still reports that it is known only vaguely.
      assert.equal(place.disclosure, "exact");
      assert.equal(place.location.precision, "broad");
    });

    it("refuses changing a disclosure without a caller", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/moments/${randomUUID()}/location/disclosure`,
        payload: { disclosure: "hidden" },
      });

      assert.equal(response.statusCode, 401, response.body);
    });
  });
});
