import { TEST_RETENTION_PERIODS } from "../../testing/retention.js";
import { testContext } from "../../testing/context.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config/app-config.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { createEmailClient } from "../../integrations/email/email-client.js";
import { createStorageClient, type StorageClient } from "../../integrations/storage/storage-client.js";
import { buildApp } from "../../server/app.js";
import { createTestAuthentication, type TestAuthentication } from "../../testing/authentication.js";
import { buildDueExports } from "../../workers/export/build.js";
import { AuthorizationRepository } from "../authorization/authorization.repository.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { IdentityRepository } from "../authentication/identity.repository.js";
import { LocationRepository } from "../locations/location.repository.js";
import { ModerationRepository } from "../moderation/moderation.repository.js";
import { MomentCommentRepository } from "../moments/moment-comment.repository.js";
import { MomentCommentService } from "../moments/moment-comment.service.js";
import { MomentRepository } from "../moments/moment.repository.js";
import { MomentService } from "../moments/moment.service.js";
import { RealWorldEventRepository } from "../real-world-events/real-world-event.repository.js";
import { FollowRepository } from "../social/follow.repository.js";
import { UploadRepository } from "../uploads/upload.repository.js";
import { UserRepository } from "../users/user.repository.js";
import { UserService } from "../users/user.service.js";
import { ExportSourceRepository } from "./export-source.repository.js";
import { ExportRepository } from "./export.repository.js";
import { ExportService } from "./export.service.js";

/**
 * Data export, against real infrastructure.
 *
 * The claim this suite has to establish is not that an export exists but that
 * it contains the right things and nothing else — so most of it fetches the
 * artefact through the signed URLs the API hands out and reads what actually
 * arrived. Asking the builders would only test the builders, which their own
 * unit suite already does.
 *
 * Requires `pnpm infra:up`.
 */

const MAILPIT = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? "8025"}`;

const config: AppConfig = {
  nodeEnv: "test",
  logLevel: "fatal",
  host: "127.0.0.1",
  port: 0,
  rateLimit: { maxPerMinute: 100_000 },
  database: {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? "5432"),
    database: process.env.POSTGRES_DATABASE ?? "chronologity",
    user: process.env.POSTGRES_USER ?? "chronologity",
    password: process.env.POSTGRES_PASSWORD ?? "chronologity",
  },
  messaging: { brokers: ["localhost:9092"], clientId: "export-integration" },
  outbox: { retentionMs: 0 },
  retention: { periods: TEST_RETENTION_PERIODS },
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

const occurrence = {
  start: "1998-06-01T00:00:00.000Z",
  end: "1998-06-01T00:00:00.000Z",
  precision: "instant",
} as const;

describe("data export", () => {
  let app: FastifyInstance;
  let database: Database;
  let authentication: TestAuthentication;
  let moments: MomentService;
  let comments: MomentCommentService;
  let exports: ExportRepository;
  let sources: ExportSourceRepository;
  let storage: StorageClient;
  let mail: ReturnType<typeof createEmailClient>;

  /** Set to make the next object write fail. */
  let storageRefuses: Error | undefined;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    authentication = createTestAuthentication(database.dataSource, config.auth, config.email);
    mail = createEmailClient(config.email);

    const real = createStorageClient(config.storage);

    storage = {
      ...real,
      presignUpload: (key, contentType) => real.presignUpload(key, contentType),
      presignDownload: (key, seconds) => real.presignDownload(key, seconds),
      head: (key) => real.head(key),
      list: (prefix) => real.list(prefix),
      remove: (key) => real.remove(key),
      put: async (key, body, contentType) => {
        if (storageRefuses !== undefined) {
          throw storageRefuses;
        }

        return real.put(key, body, contentType);
      },
    };

    const accounts = new UserRepository(database.dataSource);
    const commentRepository = new MomentCommentRepository(database.dataSource);

    exports = new ExportRepository(database.dataSource);
    sources = new ExportSourceRepository(database.dataSource);

    moments = new MomentService(
      database.dataSource,
      new MomentRepository(database.dataSource),
      new UploadRepository(database.dataSource),
      new LocationRepository(database.dataSource),
      new RealWorldEventRepository(database.dataSource),
      new FollowRepository(database.dataSource),
      accounts,
      new ModerationRepository(database.dataSource),
      commentRepository,
    );

    comments = new MomentCommentService(
      database.dataSource,
      commentRepository,
      new MomentRepository(database.dataSource),
      moments,
      new FollowRepository(database.dataSource),
      accounts,
    );

    app = await buildApp({
      config,
      dependencies: [],
      authentication,
      users: new UserService(database.dataSource, accounts, {
        minimumAgeYears: config.minimumAgeYears,
      }),
      authorization: new AuthorizationService(
        database.dataSource,
        new AuthorizationRepository(database.dataSource),
      ),
      moments,
      dataExport: new ExportService(
        database.dataSource,
        exports,
        new IdentityRepository(database.dataSource),
        sources,
        storage,
        mail,
        config.auth,
      ),
    });
  });

  afterAll(async () => {
    await app.close();
    await mail.close();
    await authentication.close();
    await database.close();
  });

  const authed = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });

  const linkFor = async (address: string, path: string, timeoutMs = 10_000): Promise<string> => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const response = await fetch(
        `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
      );
      const body = (await response.json()) as { messages?: { ID: string }[] };

      for (const message of body.messages ?? []) {
        const detail = await fetch(`${MAILPIT}/api/v1/message/${message.ID}`);
        const one = (await detail.json()) as { Text?: string };
        const found = new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`).exec(one.Text ?? "");

        if (found?.[1] !== undefined) {
          return found[1];
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    throw new Error(`No ${path} link arrived for ${address}`);
  };

  const onboard = async () => {
    const address = uniqueEmail();
    await app.inject({ method: "POST", url: "/auth/magic-link", payload: { email: address } });
    const token = await linkFor(address, "/auth/sessions");
    const session = await app.inject({
      method: "POST",
      url: "/auth/sessions",
      payload: { token },
    });

    assert.equal(session.statusCode, 201, session.body);

    const accessToken = session.json().accessToken as string;
    const handle = uniqueHandle();
    const created = await app.inject({
      method: "POST",
      url: "/users",
      headers: authed(accessToken),
      payload: { handle, displayName: "Test Person", dateOfBirth: ADULT },
    });

    assert.equal(created.statusCode, 201, created.body);

    return { accessToken, userId: created.json().userId as string, address, handle };
  };

  const record = async (authorUserId: string, caption: string): Promise<string> => {
    const uploadId = randomUUID();
    const key = `uploads/${authorUserId}/${uploadId}/original`;

    await database.dataSource.query(
      `INSERT INTO uploads (
         upload_id, owner_user_id, kind, declared_content_type, declared_byte_size,
         storage_key, state, media_kind, byte_size, content_type,
         width, height, checked_at, registered_at, expires_at, updated_at
       ) VALUES ($1, $2, 'image', 'image/jpeg', 1024, $3, 'ready', 'image', 3, 'image/jpeg',
                 100, 100, now(), now(), now() + interval '1 hour', now())`,
      [uploadId, authorUserId, key],
    );
    await storage.put(key, new Uint8Array([7, 8, 9]), "image/jpeg");

    const moment = await moments.record(authorUserId, {
      caption,
      occurrence,
      occurrenceOffsetMinutes: 0,
      uploadIds: [uploadId],
      visibility: "public",
      locationDisclosure: "exact",
    } as never, testContext());

    return moment.momentId;
  };

  /** Ask, read the link, and confirm. */
  const askForExport = async (account: { accessToken: string; address: string }) => {
    const asked = await app.inject({
      method: "POST",
      url: "/users/me/export",
      headers: authed(account.accessToken),
    });

    assert.equal(asked.statusCode, 202, asked.body);

    const token = await linkFor(account.address, "/data-exports/confirm");
    const confirmed = await app.inject({
      method: "POST",
      url: "/users/me/export/confirmation",
      headers: authed(account.accessToken),
      payload: { token },
    });

    assert.equal(confirmed.statusCode, 202, confirmed.body);

    return token;
  };

  const build = async (overrides: Record<string, unknown> = {}) => {
    const result = await buildDueExports({
      dataSource: database.dataSource,
      exports,
      sources,
      storage,
      ...overrides,
    });

    return result;
  };

  /**
   * Run the worker with a clock past every expiry, until it stops sweeping.
   *
   * One pass is not enough. The sweep takes a bounded batch from the whole
   * table, and by the end of this file there are other accounts' expired
   * exports ahead of any given one — so a single pass can finish without having
   * reached the export a test is about.
   */
  const sweepEverything = async () => {
    const future = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000);

    for (let pass = 0; pass < 50; pass += 1) {
      const result = await build({ now: future });

      if (result.swept === 0) {
        return;
      }
    }

    throw new Error("The sweep never drained");
  };

  const statusFor = async (accessToken: string) => {
    const response = await app.inject({
      method: "GET",
      url: "/users/me/export",
      headers: authed(accessToken),
    });

    return response;
  };

  /** Fetch every part of a ready export and parse it. */
  const partsOf = async (accessToken: string): Promise<Record<string, unknown>[]> => {
    const status = await statusFor(accessToken);

    assert.equal(status.statusCode, 200, status.body);
    assert.equal(status.json().state, "ready", status.body);

    const parts: Record<string, unknown>[] = [];

    for (const part of status.json().manifest.parts as { url: string }[]) {
      const response = await fetch(part.url);

      assert.equal(response.ok, true, `fetching ${part.url}`);
      parts.push((await response.json()) as Record<string, unknown>);
    }

    return parts;
  };

  describe("asking", () => {
    it("refuses somebody not signed in", async () => {
      for (const url of ["/users/me/export", "/users/me/export/confirmation"]) {
        const response = await app.inject({ method: "POST", url, payload: { token: "x" } });

        assert.equal(response.statusCode, 401, url);
      }
    });

    it("prepares nothing until the link is used", async () => {
      const account = await onboard();

      await app.inject({
        method: "POST",
        url: "/users/me/export",
        headers: authed(account.accessToken),
      });
      await linkFor(account.address, "/data-exports/confirm");

      assert.equal(await exports.findLatest(account.userId), undefined);
    });

    it("refuses a session with no link at all", async () => {
      const account = await onboard();

      const response = await app.inject({
        method: "POST",
        url: "/users/me/export/confirmation",
        headers: authed(account.accessToken),
        payload: { token: "not-a-token-anybody-issued" },
      });

      assert.equal(response.statusCode, 401, response.body);
      assert.equal(await exports.findLatest(account.userId), undefined);
    });

    it("refuses a link issued for something else", async () => {
      const account = await onboard();

      await app.inject({
        method: "POST",
        url: "/auth/password-resets",
        payload: { email: account.address },
      });

      const resetToken = await linkFor(account.address, "/password-resets/complete");
      const response = await app.inject({
        method: "POST",
        url: "/users/me/export/confirmation",
        headers: authed(account.accessToken),
        payload: { token: resetToken },
      });

      assert.equal(response.statusCode, 401, response.body);
    });

    it("refuses a link belonging to another account", async () => {
      const mine = await onboard();
      const yours = await onboard();

      await app.inject({
        method: "POST",
        url: "/users/me/export",
        headers: authed(yours.accessToken),
      });

      const yourToken = await linkFor(yours.address, "/data-exports/confirm");
      const response = await app.inject({
        method: "POST",
        url: "/users/me/export/confirmation",
        headers: authed(mine.accessToken),
        payload: { token: yourToken },
      });

      assert.equal(response.statusCode, 401, response.body);
      assert.equal(await exports.findLatest(mine.userId), undefined);
    });

    it("refuses a link that has already been used", async () => {
      const account = await onboard();
      const token = await askForExport(account);

      const again = await app.inject({
        method: "POST",
        url: "/users/me/export/confirmation",
        headers: authed(account.accessToken),
        payload: { token },
      });

      assert.equal(again.statusCode, 401, again.body);
    });
  });

  describe("what a prepared export contains", () => {
    it("carries the account, its Moments, and their occurrences", async () => {
      const account = await onboard();
      const caption = `zq${randomUUID().replaceAll("-", "")}`;

      await record(account.userId, caption);
      await askForExport(account);
      await build();

      const [first] = await partsOf(account.accessToken);
      const exported = first as {
        account: { handle: string; displayName: string };
        moments: { caption: string; occurrence: { start: string; precision: string } }[];
      };

      assert.equal(exported.account.handle, account.handle);
      assert.equal(exported.account.displayName, "Test Person");
      assert.equal(exported.moments.length, 1);
      assert.equal(exported.moments[0]?.caption, caption);
      assert.equal(exported.moments[0]?.occurrence.start, occurrence.start);
      assert.equal(exported.moments[0]?.occurrence.precision, "instant");
    });

    it("carries other people's comments, attributed by handle", async () => {
      const account = await onboard();
      const talker = await onboard();
      const momentId = await record(account.userId, "a caption");
      const said = `zq${randomUUID().replaceAll("-", "")}`;

      await comments.add(momentId, talker.userId, { body: said } as never);
      await askForExport(account);
      await build();

      const [first] = await partsOf(account.accessToken);
      const exported = first as {
        comments: { body: string; author: { handle: string; displayName: string } }[];
      };

      // The account can already read this in the application; an export that
      // stripped it would be a worse record than the product.
      assert.equal(exported.comments.length, 1);
      assert.equal(exported.comments[0]?.body, said);
      assert.equal(exported.comments[0]?.author.handle, talker.handle);
    });

    it("carries relationships by handle", async () => {
      const account = await onboard();
      const followed = await onboard();

      // Written directly. This suite does not mount the follow routes, and an
      // injected request that quietly answered 404 is what made an earlier
      // version of this test pass while asserting nothing.
      await database.dataSource.query(
        `INSERT INTO user_follows (follower_user_id, followed_user_id, created_at)
         VALUES ($1, $2, now())`,
        [account.userId, followed.userId],
      );

      await askForExport(account);
      await build();

      const [first] = await partsOf(account.accessToken);
      const exported = first as { relationships: { following: { handle: string }[] } };

      assert.deepEqual(
        exported.relationships.following.map((one) => one.handle),
        [followed.handle],
      );
    });

    it("splits a history larger than one part, and lists them all", async () => {
      const account = await onboard();

      for (let index = 0; index < 3; index += 1) {
        await record(account.userId, `moment ${index}`);
      }

      await askForExport(account);
      await build({ momentsPerPart: 1 });

      const parts = await partsOf(account.accessToken);

      assert.equal(parts.length, 3);
      assert.equal((parts[0] as { moments: unknown[] }).moments.length, 1);
      assert.equal((parts[2] as { moments: unknown[] }).moments.length, 1);
    });

    it("prepares an export for an account with no Moments at all", async () => {
      const account = await onboard();

      await askForExport(account);
      await build();

      const parts = await partsOf(account.accessToken);

      assert.equal(parts.length, 1);
      assert.deepEqual((parts[0] as { moments: unknown[] }).moments, []);
    });

    it("hands back the media itself", async () => {
      const account = await onboard();

      await record(account.userId, "a caption");
      await askForExport(account);
      await build();

      const status = await statusFor(account.accessToken);
      const media = status.json().manifest.media as { url: string; byteSize: number }[];

      assert.equal(media.length, 1);

      const bytes = await fetch(media[0]!.url);

      assert.equal(bytes.ok, true);
      assert.deepEqual([...new Uint8Array(await bytes.arrayBuffer())], [7, 8, 9]);
    });
  });

  describe("what a prepared export must not contain", () => {
    it("carries no address, Identity, session, or storage key", async () => {
      const account = await onboard();
      const talker = await onboard();
      const momentId = await record(account.userId, "a caption");

      await comments.add(momentId, talker.userId, { body: "something said" } as never);
      await askForExport(account);
      await build();

      const everything = JSON.stringify(await partsOf(account.accessToken));

      const secrets: { identity_id: string }[] = await database.dataSource.query(
        `SELECT identity_id FROM users WHERE user_id = ANY($1::uuid[])`,
        [[account.userId, talker.userId]],
      );

      // Asked of the artefact rather than of the builders, because what matters
      // is what actually arrived in the file somebody downloaded.
      assert.equal(everything.includes(account.address), false, "own address");
      assert.equal(everything.includes(talker.address), false, "somebody else's address");
      assert.equal(everything.includes("uploads/"), false, "storage key");

      for (const row of secrets) {
        assert.equal(everything.includes(row.identity_id), false, "identity");
      }

      // Somebody else's account identifier would let exports be correlated in
      // a way the product never allowed.
      assert.equal(everything.includes(talker.userId), false, "another account's identifier");
    });

    it("signs every link to expire in minutes", async () => {
      const account = await onboard();

      await record(account.userId, "a caption");
      await askForExport(account);
      await build();

      const status = await statusFor(account.accessToken);
      const manifest = status.json().manifest as {
        parts: { url: string }[];
        media: { url: string }[];
      };

      assert.ok(manifest.parts.length > 0);
      assert.ok(manifest.media.length > 0);

      // `architecture/security.md:1776` requires short-lived download access.
      // A link signed for hours is one somebody who kept the manifest can still
      // use tomorrow, which is the same as no expiry at all.
      for (const link of [...manifest.parts, ...manifest.media]) {
        const expires = Number(new URL(link.url).searchParams.get("X-Amz-Expires"));

        assert.ok(expires > 0, link.url);
        assert.ok(expires <= 300, `${expires} seconds is not short-lived`);
      }
    });

    it("carries nobody else's Moments", async () => {
      const account = await onboard();
      const stranger = await onboard();
      const theirs = `zq${randomUUID().replaceAll("-", "")}`;

      await record(stranger.userId, theirs);
      await record(account.userId, "mine");
      await askForExport(account);
      await build();

      const everything = JSON.stringify(await partsOf(account.accessToken));

      assert.equal(everything.includes(theirs), false);
    });
  });

  describe("when a store refuses", () => {
    it("leaves the request owed and finishes on a later run", async () => {
      const account = await onboard();

      await record(account.userId, "a caption");
      await askForExport(account);

      storageRefuses = new Error("the object store is unreachable");
      await build();
      storageRefuses = undefined;

      const failed = await exports.findLatest(account.userId);

      assert.equal(failed?.state, "pending");
      assert.equal(failed?.attempts, 1);

      await build({ now: () => new Date(Date.now() + 60 * 60 * 1_000) });

      assert.equal((await exports.findLatest(account.userId))?.state, "ready");
    });

    it("gives up rather than retrying forever", async () => {
      const account = await onboard();

      await askForExport(account);
      storageRefuses = new Error("the object store is unreachable");

      for (let round = 0; round < 2; round += 1) {
        await build({
          maximumAttempts: 2,
          now: () => new Date(Date.now() + round * 60 * 60 * 1_000),
        });
      }

      storageRefuses = undefined;

      assert.equal((await exports.findLatest(account.userId))?.state, "abandoned");
    });
  });

  describe("expiry", () => {
    it("stops offering an export once its life has run out", async () => {
      const account = await onboard();

      await record(account.userId, "a caption");
      await askForExport(account);
      await build({ retentionDays: 0 });

      const status = await statusFor(account.accessToken);

      // Nothing to download, and said plainly rather than as a failure.
      assert.equal(status.json().state, "expired");
      assert.equal(status.json().manifest, undefined);
    });

    it("removes the objects a run-out export left behind", async () => {
      const account = await onboard();

      await record(account.userId, "a caption");
      await askForExport(account);
      await build();

      const prepared = await exports.findLatest(account.userId);
      const prefix = prepared?.storagePrefix ?? "";

      assert.notEqual(prefix, "");
      assert.ok((await storage.list(prefix)).length > 0, "written");

      // A clock past the expiry, rather than a zero retention: with zero, the
      // sweep in the same pass removes what that pass just wrote, and the test
      // would be asserting against an export that never really existed.
      await sweepEverything();

      assert.deepEqual(await storage.list(prefix), []);
      assert.equal((await exports.findLatest(account.userId))?.state, "expired");
    });

    it("removes what an earlier export left when a new one is prepared", async () => {
      const account = await onboard();

      await record(account.userId, "a caption");
      await askForExport(account);
      await build();

      const first = await exports.findLatest(account.userId);
      const firstPrefix = first?.storagePrefix ?? "";

      assert.ok((await storage.list(firstPrefix)).length > 0);

      await askForExport(account);
      await build();

      // Two copies of somebody's history where they asked for one is the thing
      // this prevents.
      assert.deepEqual(await storage.list(firstPrefix), []);
      assert.equal((await exports.findLatest(account.userId))?.state, "ready");
    });
  });
});
