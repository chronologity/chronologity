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
import { createPendingUpload, createReadyUpload } from "../../testing/fixtures.js";
import { MomentRepository } from "./moment.repository.js";
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
  database: {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? "5432"),
    database: process.env.POSTGRES_DATABASE ?? "chronologity",
    user: process.env.POSTGRES_USER ?? "chronologity",
    password: process.env.POSTGRES_PASSWORD ?? "chronologity",
  },
  messaging: { brokers: ["localhost:9092"], clientId: "moments-integration" },
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
      moments: new MomentService(
        database.dataSource,
        new MomentRepository(database.dataSource),
        new UploadRepository(database.dataSource),
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
      assert.equal(response.json().visibility, "private");
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

      // Every Moment is private to its author. Saying "this exists but is not
      // yours" would itself disclose that somebody recorded something.
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
});
