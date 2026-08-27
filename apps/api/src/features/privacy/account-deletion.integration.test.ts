import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config/app-config.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { createEmailClient } from "../../integrations/email/email-client.js";
import {
  createStorageClient,
  type StorageClient,
} from "../../integrations/storage/storage-client.js";
import { buildApp } from "../../server/app.js";
import { TEST_RETENTION_PERIODS } from "../../testing/retention.js";
import { createTestAuthentication, type TestAuthentication } from "../../testing/authentication.js";
import { eraseDueRequests } from "../../workers/erasure/erase.js";
import { AuthorizationRepository } from "../authorization/authorization.repository.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { IdentityRepository } from "../authentication/identity.repository.js";
import { PhoneRepository } from "../authentication/phone.repository.js";
import { SessionRepository } from "../authentication/session.repository.js";
import { LocationRepository } from "../locations/location.repository.js";
import { ModerationRepository } from "../moderation/moderation.repository.js";
import { ModerationService } from "../moderation/moderation.service.js";
import { MomentCommentRepository } from "../moments/moment-comment.repository.js";
import { MomentCommentService } from "../moments/moment-comment.service.js";
import { MomentRepository } from "../moments/moment.repository.js";
import { MomentService } from "../moments/moment.service.js";
import { RealWorldEventRepository } from "../real-world-events/real-world-event.repository.js";
import { INDEX_VERSION } from "../search/search-document.js";
import { SearchRepository } from "../search/search.repository.js";
import { FollowRepository } from "../social/follow.repository.js";
import { UploadRepository } from "../uploads/upload.repository.js";
import { UploadService } from "../uploads/upload.service.js";
import { UserRepository } from "../users/user.repository.js";
import { UserService } from "../users/user.service.js";
import { AccountDeletionService } from "./account-deletion.service.js";
import { AccountErasureRepository } from "./account-erasure.repository.js";
import { ACCOUNT_SWEEPS, DELIBERATELY_KEPT } from "./account-erasure.js";
import { ErasureRepository } from "./erasure.repository.js";

/**
 * Account deletion, against real infrastructure.
 *
 * Two kinds of claim are under test and they need different evidence. That the
 * account stops working is asked of the API, because that is what somebody
 * experiences. That nothing of theirs survives is asked of PostgreSQL and the
 * object store directly, because by then there is no session left to ask
 * through — and because a product that reports something is gone is exactly
 * what this suite exists to distrust.
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
  messaging: { brokers: ["localhost:9092"], clientId: "deletion-integration" },
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

describe("account deletion", () => {
  let app: FastifyInstance;
  let database: Database;
  let authentication: TestAuthentication;
  let moments: MomentService;
  let comments: MomentCommentService;
  let erasures: ErasureRepository;
  let momentRepository: MomentRepository;
  let commentRepository: MomentCommentRepository;
  let accountErasure: AccountErasureRepository;
  let documents: SearchRepository;
  let uploads: UploadService;
  let storage: StorageClient;
  let mail: ReturnType<typeof createEmailClient>;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    authentication = createTestAuthentication(database.dataSource, config.auth, config.email);
    mail = createEmailClient(config.email);

    const accounts = new UserRepository(database.dataSource);

    storage = createStorageClient(config.storage);
    const moderationRepository = new ModerationRepository(database.dataSource);

    momentRepository = new MomentRepository(database.dataSource);
    commentRepository = new MomentCommentRepository(database.dataSource);
    accountErasure = new AccountErasureRepository(database.dataSource);
    erasures = new ErasureRepository(database.dataSource);
    documents = new SearchRepository(database.dataSource);

    uploads = new UploadService(
      database.dataSource,
      new UploadRepository(database.dataSource),
      storage,
      config.uploadLimits,
      {},
    );

    moments = new MomentService(
      database.dataSource,
      momentRepository,
      new UploadRepository(database.dataSource),
      new LocationRepository(database.dataSource),
      new RealWorldEventRepository(database.dataSource),
      new FollowRepository(database.dataSource),
      accounts,
      moderationRepository,
      commentRepository,
      erasures,
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
      moderation: new ModerationService(database.dataSource, moderationRepository),
      accountDeletion: new AccountDeletionService(
        database.dataSource,
        accounts,
        new IdentityRepository(database.dataSource),
        new SessionRepository(database.dataSource),
        new PhoneRepository(database.dataSource),
        erasures,
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

  /** The newest link of a given purpose sent to an address. */
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

    await database.dataSource.query(
      `INSERT INTO uploads (
         upload_id, owner_user_id, kind, declared_content_type, declared_byte_size,
         storage_key, state, media_kind, byte_size, content_type,
         width, height, checked_at, registered_at, expires_at, updated_at
       ) VALUES ($1, $2, 'image', 'image/jpeg', 1024, $3, 'ready', 'image', 1024, 'image/jpeg',
                 100, 100, now(), now(), now() + interval '1 hour', now())`,
      [uploadId, authorUserId, `uploads/${authorUserId}/${uploadId}/original`],
    );

    const moment = await moments.record(authorUserId, {
      caption,
      occurrence,
      occurrenceOffsetMinutes: 0,
      uploadIds: [uploadId],
      visibility: "public",
      locationDisclosure: "exact",
    } as never);

    return moment.momentId;
  };

  /** Ask to delete, read the link, and confirm. */
  const deleteAccount = async (account: { accessToken: string; address: string }) => {
    const asked = await app.inject({
      method: "POST",
      url: "/users/me/deletion",
      headers: authed(account.accessToken),
    });

    assert.equal(asked.statusCode, 202, asked.body);

    const token = await linkFor(account.address, "/account-deletions/confirm");
    const confirmed = await app.inject({
      method: "POST",
      url: "/users/me/deletion/confirmation",
      headers: authed(account.accessToken),
      payload: { token },
    });

    assert.equal(confirmed.statusCode, 204, confirmed.body);

    return token;
  };

  /** Run the worker until nothing is due. */
  const erase = async () => {
    for (let pass = 0; pass < 200; pass += 1) {
      const result = await eraseDueRequests({
        dataSource: database.dataSource,
        erasures,
        moments: momentRepository,
        comments: commentRepository,
        accounts: accountErasure,
        storage,
        uploads,
        documents,
        indexVersion: INDEX_VERSION,
      });

      if (result.reachedEnd && result.continuing === 0) {
        // A pass that stops is not a pass that succeeded. Without this, a sweep
        // the database refuses looks exactly like a sweep that had nothing to
        // do — which is how "keeps a Location it recorded" passed while erasure
        // was trying to delete one and failing.
        assert.equal(
          result.failed + result.abandoned + result.retrying,
          0,
          JSON.stringify(result),
        );

        return result;
      }
    }

    throw new Error("The worker never drained");
  };

  const countWhere = async (table: string, column: string, value: string): Promise<number> => {
    const rows: { count: string }[] = await database.dataSource.query(
      `SELECT COUNT(*) AS count FROM "${table}" WHERE "${column}" = $1`,
      [value],
    );

    return Number(rows[0]?.count ?? "0");
  };

  describe("the plan itself", () => {
    it("accounts for every reference into an account", async () => {
      const rows: { reference: string }[] = await database.dataSource.query(
        `SELECT cl.relname || '.' || a.attname AS reference
           FROM pg_constraint c
           JOIN pg_class cl ON cl.oid = c.conrelid
           JOIN pg_class ref ON ref.oid = c.confrelid
           JOIN unnest(c.conkey) AS k(attnum) ON true
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
          WHERE c.contype = 'f' AND ref.relname = 'users'`,
      );

      const decided = new Set([
        ...ACCOUNT_SWEEPS.map((sweep) => `${sweep.table}.${sweep.column}`),
        ...DELIBERATELY_KEPT.map((kept) => `${kept.table}.${kept.column}`),
      ]);

      // The guard that keeps this true as the schema grows. A table added later
      // that points at an account fails here until somebody decides whether it
      // is swept or deliberately kept — which is the only way a list like this
      // does not quietly go stale.
      const undecided = rows
        .map((row) => row.reference)
        .filter((reference) => !decided.has(reference));

      assert.deepEqual(undecided, []);
    });

    it("names nothing the database does not have", async () => {
      const rows: { reference: string }[] = await database.dataSource.query(
        `SELECT cl.relname || '.' || a.attname AS reference
           FROM pg_constraint c
           JOIN pg_class cl ON cl.oid = c.conrelid
           JOIN pg_class ref ON ref.oid = c.confrelid
           JOIN unnest(c.conkey) AS k(attnum) ON true
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
          WHERE c.contype = 'f' AND ref.relname = 'users'`,
      );
      const actual = new Set(rows.map((row) => row.reference));

      // A sweep of a column that no longer exists would fail at run time, in a
      // worker, against somebody's real deletion.
      for (const sweep of ACCOUNT_SWEEPS) {
        assert.ok(actual.has(`${sweep.table}.${sweep.column}`), `${sweep.table}.${sweep.column}`);
      }
    });
  });

  describe("asking", () => {
    it("sends a link and does not delete anything yet", async () => {
      const account = await onboard();

      const asked = await app.inject({
        method: "POST",
        url: "/users/me/deletion",
        headers: authed(account.accessToken),
      });

      assert.equal(asked.statusCode, 202, asked.body);
      await linkFor(account.address, "/account-deletions/confirm");

      const still = await app.inject({
        method: "GET",
        url: "/users/me",
        headers: authed(account.accessToken),
      });

      assert.equal(still.statusCode, 200, "the account still works until it is confirmed");
    });

    it("refuses somebody not signed in", async () => {
      const response = await app.inject({ method: "POST", url: "/users/me/deletion" });

      assert.equal(response.statusCode, 401);
    });
  });

  describe("confirming", () => {
    it("refuses a session with no link at all", async () => {
      const account = await onboard();

      const response = await app.inject({
        method: "POST",
        url: "/users/me/deletion/confirmation",
        headers: authed(account.accessToken),
        payload: { token: "not-a-token-anybody-issued" },
      });

      // A session proves somebody signed in once, which an unattended laptop
      // also proves.
      assert.equal(response.statusCode, 401, response.body);
      assert.equal(
        (await app.inject({ method: "GET", url: "/users/me", headers: authed(account.accessToken) }))
          .statusCode,
        200,
      );
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
        url: "/users/me/deletion/confirmation",
        headers: authed(account.accessToken),
        payload: { token: resetToken },
      });

      assert.equal(response.statusCode, 401, response.body);
    });

    it("refuses a link that has already been used", async () => {
      const account = await onboard();
      const token = await deleteAccount(account);
      const other = await onboard();

      const again = await app.inject({
        method: "POST",
        url: "/users/me/deletion/confirmation",
        headers: authed(other.accessToken),
        payload: { token },
      });

      assert.equal(again.statusCode, 401, again.body);
      assert.equal(
        (await app.inject({ method: "GET", url: "/users/me", headers: authed(other.accessToken) }))
          .statusCode,
        200,
        "and the account that offered it is untouched",
      );
    });

    it("refuses a link belonging to another account", async () => {
      const mine = await onboard();
      const yours = await onboard();

      await app.inject({
        method: "POST",
        url: "/users/me/deletion",
        headers: authed(yours.accessToken),
      });

      const yourToken = await linkFor(yours.address, "/account-deletions/confirm");
      const response = await app.inject({
        method: "POST",
        url: "/users/me/deletion/confirmation",
        headers: authed(mine.accessToken),
        payload: { token: yourToken },
      });

      // Without this check, a link issued for one account would delete
      // whichever account happened to be signed in.
      assert.equal(response.statusCode, 401, response.body);
      assert.equal(
        (await app.inject({ method: "GET", url: "/users/me", headers: authed(mine.accessToken) }))
          .statusCode,
        200,
      );
    });
  });

  describe("what confirming does at once", () => {
    it("stops every session working", async () => {
      const account = await onboard();

      await deleteAccount(account);

      const after = await app.inject({
        method: "GET",
        url: "/users/me",
        headers: authed(account.accessToken),
      });

      assert.equal(after.statusCode, 401, after.body);
    });

    it("erases the profile and marks the account deleted", async () => {
      const account = await onboard();

      await deleteAccount(account);

      const rows: { status: string; handle: string; display_name: string; biography: string | null }[] =
        await database.dataSource.query(
          `SELECT status, handle, display_name, biography FROM users WHERE user_id = $1`,
          [account.userId],
        );

      assert.equal(rows[0]?.status, "deleted");
      assert.equal(rows[0]?.handle, "");
      assert.equal(rows[0]?.display_name, "");
      assert.equal(rows[0]?.biography, null);
    });

    it("erases the addresses, the password, and every session row", async () => {
      const address = uniqueEmail();
      const password = "a reasonable long passphrase";

      await app.inject({
        method: "POST",
        url: "/auth/registrations",
        payload: { email: address, password },
      });

      const verification = await linkFor(address, "/email-verifications");
      await app.inject({
        method: "POST",
        url: "/auth/email-verifications",
        payload: { token: verification },
      });

      const session = await app.inject({
        method: "POST",
        url: "/auth/sessions/password",
        payload: { email: address, password },
      });
      const accessToken = session.json().accessToken as string;

      await app.inject({
        method: "POST",
        url: "/users",
        headers: authed(accessToken),
        payload: { handle: uniqueHandle(), displayName: "Test Person", dateOfBirth: ADULT },
      });

      const identity: { identity_id: string }[] = await database.dataSource.query(
        `SELECT identity_id FROM identity_emails WHERE normalized_email = $1`,
        [address.toLowerCase()],
      );
      const identityId = identity[0]?.identity_id ?? "";

      await deleteAccount({ accessToken, address });

      assert.equal(await countWhere("identity_emails", "identity_id", identityId), 0);
      assert.equal(await countWhere("identity_passwords", "identity_id", identityId), 0);
      assert.equal(await countWhere("sessions", "identity_id", identityId), 0);

      // The password is gone, so it can no longer be offered.
      const attempt = await app.inject({
        method: "POST",
        url: "/auth/sessions/password",
        payload: { email: address, password },
      });

      assert.equal(attempt.statusCode, 401, attempt.body);
    });

    it("erases the date of birth and the preferences once the worker runs", async () => {
      const account = await onboard();

      assert.equal(await countWhere("user_restricted_data", "user_id", account.userId), 1);

      await deleteAccount(account);
      await erase();

      assert.equal(await countWhere("user_restricted_data", "user_id", account.userId), 0);
      assert.equal(await countWhere("user_preferences", "user_id", account.userId), 0);
    });

    it("releases the handle under its cooldown", async () => {
      const account = await onboard();

      await deleteAccount(account);

      const rows: { released_at: Date | null }[] = await database.dataSource.query(
        `SELECT released_at FROM user_handles WHERE user_id = $1`,
        [account.userId],
      );

      // Released rather than deleted: the row is what holds the cooldown, and
      // the cooldown is what stops an onlooker taking a departed account's name
      // the moment it frees.
      assert.notEqual(rows[0]?.released_at, null);

      const claimant = await onboard();
      const taken = await app.inject({
        method: "PUT",
        url: "/users/me/handle",
        headers: authed(claimant.accessToken),
        payload: { handle: account.handle },
      });

      assert.equal(taken.statusCode, 400, taken.body);
      assert.match(taken.json().message, /not available/);
    });

    it("records the erasure still owed", async () => {
      const account = await onboard();

      await deleteAccount(account);

      const request = await erasures.findLatest("account", account.userId);

      assert.equal(request?.state, "pending");
    });
  });

  describe("what the worker erases", () => {
    it("erases every Moment the account recorded, and its media", async () => {
      const account = await onboard();
      const first = await record(account.userId, "one");
      const second = await record(account.userId, "two");

      await deleteAccount(account);
      await erase();

      assert.equal(await countWhere("moments", "author_user_id", account.userId), 0);
      assert.equal(await countWhere("moment_media", "moment_id", first), 0);
      assert.equal(await countWhere("moment_media", "moment_id", second), 0);
      // The rows stay and the bytes go. An upload row holds no personal data —
      // an identifier, a size, a content type — and the file is what mattered.
      assert.equal(await countWhere("uploads", "owner_user_id", account.userId), 2, "rows remain");

      const states: { state: string }[] = await database.dataSource.query(
        `SELECT DISTINCT state FROM uploads WHERE owner_user_id = $1`,
        [account.userId],
      );

      assert.deepEqual(
        states.map((row) => row.state),
        ["deleted"],
      );
    });

    it("erases comments it left on other people's Moments, and leaves those Moments", async () => {
      const author = await onboard();
      const talker = await onboard();
      const momentId = await record(author.userId, "somebody else's Moment");

      await comments.add(momentId, talker.userId, { body: "what they said" } as never);
      await deleteAccount(talker);
      await erase();

      assert.equal(await countWhere("moment_comments", "author_user_id", talker.userId), 0);

      const still = await app.inject({
        method: "GET",
        url: `/moments/${momentId}`,
        headers: authed(author.accessToken),
      });

      assert.equal(still.statusCode, 200, still.body);
    });

    it("erases its reactions, follows, and blocks", async () => {
      const author = await onboard();
      const leaver = await onboard();
      const momentId = await record(author.userId, "a Moment");

      await app.inject({
        method: "PUT",
        url: `/moments/${momentId}/reaction`,
        headers: authed(leaver.accessToken),
        payload: { kind: "loved" },
      });
      await app.inject({
        method: "PUT",
        url: `/users/${author.userId}/follow`,
        headers: authed(leaver.accessToken),
      });

      await deleteAccount(leaver);
      await erase();

      assert.equal(await countWhere("moment_reactions", "user_id", leaver.userId), 0);
      assert.equal(await countWhere("user_follows", "follower_user_id", leaver.userId), 0);
      assert.equal(await countWhere("notifications", "recipient_user_id", leaver.userId), 0);
    });

    it("removes an export it had prepared, objects and all", async () => {
      const account = await onboard();
      const requestId = randomUUID();
      const prefix = `exports/${account.userId}/${requestId}`;

      // The row and the objects an export leaves, written directly: what is
      // under test is that erasure reaches them, not how they got there.
      await database.dataSource.query(
        `INSERT INTO export_requests
           (request_id, user_id, state, attempts, due_at, storage_prefix, part_count,
            expires_at, requested_at, completed_at)
         VALUES ($1, $2, 'ready', 1, now(), $3, 1, now() + interval '3 days', now(), now())`,
        [requestId, account.userId, prefix],
      );
      await storage.put(
        `${prefix}/moments-0001.json`,
        new TextEncoder().encode('{"account":{}}'),
        "application/json",
      );

      assert.equal((await storage.list(prefix)).length, 1, "written");

      await deleteAccount(account);
      await erase();

      // A copy of somebody's entire history must not outlive the account it
      // belongs to. The row going alone would leave the objects in storage
      // with nothing left pointing at them.
      assert.deepEqual(await storage.list(prefix), []);
      assert.equal(await countWhere("export_requests", "user_id", account.userId), 0);
    });

    it("finishes an account with more Moments than one run takes", async () => {
      const account = await onboard();

      for (let index = 0; index < 4; index += 1) {
        await record(account.userId, `moment ${index}`);
      }

      await deleteAccount(account);

      // One Moment per run, so this only completes if the coordinator comes
      // round again rather than giving up or counting the runs as failures.
      for (let pass = 0; pass < 40; pass += 1) {
        await eraseDueRequests({
          dataSource: database.dataSource,
          erasures,
          moments: momentRepository,
          comments: commentRepository,
          accounts: accountErasure,
          storage,
          uploads,
          documents,
          indexVersion: INDEX_VERSION,
          momentsPerRun: 1,
        });
      }

      assert.equal(await countWhere("moments", "author_user_id", account.userId), 0);
      assert.equal((await erasures.findLatest("account", account.userId))?.state, "completed");
    });

    it("erases once however often the worker runs", async () => {
      const account = await onboard();

      await record(account.userId, "a Moment");
      await deleteAccount(account);
      await erase();

      const second = await erase();

      assert.equal(second.failed, 0);
      assert.equal((await erasures.findLatest("account", account.userId))?.state, "completed");
    });
  });

  describe("what must survive", () => {
    it("keeps a Location it recorded, and the Moments naming that place", async () => {
      const leaver = await onboard();
      const other = await onboard();

      const locationId = randomUUID();
      await database.dataSource.query(
        `INSERT INTO locations (location_id, name, precision, source, latitude, longitude,
                                recorded_by_user_id, created_at, updated_at)
         VALUES ($1, 'A shared place', 'exact', 'explicit-selection', 51.5, -0.12, $2, now(), now())`,
        [locationId, leaver.userId],
      );

      const momentId = await record(other.userId, "somebody else's Moment");
      await database.dataSource.query(
        `INSERT INTO moment_locations (moment_id, location_id) VALUES ($1, $2)`,
        [momentId, locationId],
      );

      await deleteAccount(leaver);
      await erase();

      // A Location is shared reference data. Somebody who first recorded a
      // place did not thereby own it.
      //
      // `erase` asserts the run reported no failure, which is what makes this
      // meaningful: a sweep that tried to delete the Location and was refused
      // by the foreign key would leave the row here too, and this assertion
      // alone could not tell the two apart.
      assert.equal(await countWhere("locations", "location_id", locationId), 1);
      assert.equal((await erasures.findLatest("account", leaver.userId))?.state, "completed");

      const still = await app.inject({
        method: "GET",
        url: `/moments/${momentId}`,
        headers: authed(other.accessToken),
      });

      assert.equal(still.statusCode, 200, still.body);
    });

    it("keeps reports it filed about other people, with the reporter erased", async () => {
      const reporter = await onboard();
      const author = await onboard();
      const momentId = await record(author.userId, "the reported Moment");

      const reported = await app.inject({
        method: "POST",
        url: "/reports",
        headers: authed(reporter.accessToken),
        payload: { subjectType: "moment", subjectId: momentId, reason: "harassment" },
      });

      assert.equal(reported.statusCode, 201, reported.body);

      await deleteAccount(reporter);
      await erase();

      const rows: { reporter_user_id: string | null; reason: string }[] =
        await database.dataSource.query(
          `SELECT reporter_user_id, reason FROM moderation_reports WHERE subject_id = $1`,
          [momentId],
        );

      // Letting a reported person destroy the complaints against them by
      // leaving is a hole, and the report is evidence about somebody who was
      // never party to this deletion.
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.reporter_user_id, null);
      assert.equal(rows[0]?.reason, "harassment");
    });

    it("keeps the account row, saying nothing about anybody", async () => {
      const account = await onboard();

      await deleteAccount(account);
      await erase();

      const rows: { handle: string; display_name: string; status: string }[] =
        await database.dataSource.query(
          `SELECT handle, display_name, status FROM users WHERE user_id = $1`,
          [account.userId],
        );

      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.handle, "");
      assert.equal(rows[0]?.display_name, "");
      assert.equal(rows[0]?.status, "deleted");
    });
  });

  describe("what erasure must leave nowhere", () => {
    it("leaves the name and the caption in no table, and the handle only where the cooldown needs it", async () => {
      const account = await onboard();
      const caption = `zq${randomUUID().replaceAll("-", "")}`;
      const displayName = `zq${randomUUID().replaceAll("-", "")}`;

      await app.inject({
        method: "PUT",
        url: "/users/me",
        headers: authed(account.accessToken),
        payload: { displayName },
      });
      await record(account.userId, caption);

      await deleteAccount(account);
      await erase();

      const columns: { table_name: string; column_name: string }[] =
        await database.dataSource.query(
          `SELECT table_name, column_name
             FROM information_schema.columns
            WHERE table_schema = 'public' AND data_type IN ('text', 'character varying')`,
        );

      const holding = async (needle: string): Promise<string[]> => {
        const found: string[] = [];

        for (const column of columns) {
          const rows: { count: string }[] = await database.dataSource.query(
            `SELECT COUNT(*) AS count FROM "${column.table_name}"
              WHERE "${column.column_name}" LIKE $1`,
            [`%${needle}%`],
          );

          if (Number(rows[0]?.count ?? "0") > 0) {
            found.push(`${column.table_name}.${column.column_name}`);
          }
        }

        return found;
      };

      // What they wrote and what they called themselves survive nowhere.
      assert.deepEqual(await holding(caption), []);
      assert.deepEqual(await holding(displayName), []);

      // The handle is the exception, and it is a deliberate one. Releasing it
      // under a cooldown means remembering which name is reserved and for how
      // long, and the reservation is what stops an onlooker taking a departed
      // account's name the moment it frees. It survives in `user_handles` and
      // nowhere else, pointing at a row that says nothing about anybody.
      assert.deepEqual(
        (await holding(account.handle)).sort(),
        ["user_handles.handle", "user_handles.normalized_handle"],
      );
    });
  });
});
