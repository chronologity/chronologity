import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { createStorageClient, type StorageClient } from "../../integrations/storage/storage-client.js";
import { createUser, type TestUser } from "../../testing/fixtures.js";
import { TEST_RETENTION_PERIODS } from "../../testing/retention.js";
import { sweepRetained } from "../../workers/retention/sweep.js";
import { UploadRepository } from "../uploads/upload.repository.js";
import { UploadService } from "../uploads/upload.service.js";
import { uploadPrefix } from "../uploads/upload.storage-key.js";
import { RETENTION_SCHEDULE, type RetentionPeriods } from "./retention.policy.js";
import { RetentionRepository } from "./retention.repository.js";

/**
 * Retention, against real infrastructure.
 *
 * Two claims to establish, and they pull in opposite directions. That the
 * residue goes: consumed links, spent codes, delivery records, retired tokens,
 * audit events, unfinished uploads. And that nothing else does — no Moment, no
 * comment, no reaction, no moderation record — which is asserted by counting
 * them across a sweep with every period set to zero, the most destructive
 * configuration the system permits.
 *
 * Everything is read from PostgreSQL and object storage directly. There is no
 * API surface here at all: nothing in this sub-phase is a request anybody
 * makes.
 *
 * Requires `pnpm infra:up`.
 */

const database = { host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? "5432"),
  database: process.env.POSTGRES_DATABASE ?? "chronologity",
  user: process.env.POSTGRES_USER ?? "chronologity",
  password: process.env.POSTGRES_PASSWORD ?? "chronologity" };

const storageConfig = {
  endpoint: process.env.S3_ENDPOINT ?? "http://127.0.0.1:8333",
  region: process.env.S3_REGION ?? "us-east-1",
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "chronologity",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "chronologity-local-secret",
  bucket: process.env.S3_BUCKET ?? "chronologity-media",
  forcePathStyle: true,
  uploadUrlTtlSeconds: 900,
};

/** Every period at zero: anything the schedule can reach, it reaches. */
const NOTHING_RETAINED: RetentionPeriods = Object.fromEntries(
  Object.keys(TEST_RETENTION_PERIODS).map((period) => [period, 0]),
) as RetentionPeriods;

const ago = (days: number): Date => new Date(Date.now() - days * 24 * 60 * 60 * 1_000);

describe("retention", () => {
  let connection: Database;
  let retention: RetentionRepository;
  let uploads: UploadService;
  let storage: StorageClient;
  let owner: TestUser;

  beforeAll(async () => {
    connection = createDatabase(database);
    await connectDatabase(connection);
    await migrate(connection.dataSource);

    storage = createStorageClient(storageConfig);
    retention = new RetentionRepository(connection.dataSource);
    uploads = new UploadService(
      connection.dataSource,
      new UploadRepository(connection.dataSource),
      storage,
      { registrationTtlSeconds: 3_600, maxImageBytes: 26_214_400, maxVideoBytes: 524_288_000 },
      {},
    );
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    owner = await createUser(connection.dataSource);
  });

  /**
   * Run every sweep until nothing is left to remove.
   *
   * Draining rather than one pass. Each sweep takes a bounded batch ordered
   * oldest-first from a database this suite shares, so a single pass can remove
   * five hundred of somebody else's rows and none of this test's.
   */
  const sweep = async (periods: RetentionPeriods = NOTHING_RETAINED, batchSize = 500) => {
    let last = await sweepRetained({ retention, uploads, periods, batchSize });

    for (let pass = 0; pass < 200 && !last.reachedEnd; pass += 1) {
      last = await sweepRetained({ retention, uploads, periods, batchSize });
    }

    return last;
  };

  const countWhere = async (
    table: string,
    column: string,
    value: string,
  ): Promise<number> => {
    const rows: { count: string }[] = await connection.dataSource.query(
      `SELECT COUNT(*) AS count FROM "${table}" WHERE "${column}" = $1`,
      [value],
    );

    return Number(rows[0]?.count ?? "0");
  };

  const notification = async (
    category: string,
    createdAt: Date,
    readAt: Date | null,
  ): Promise<string> => {
    const notificationId = randomUUID();

    await connection.dataSource.query(
      `INSERT INTO notifications
         (notification_id, recipient_user_id, type, category, source_type, source_id,
          aggregation_key, created_at, read_at)
       VALUES ($1, $2, 'moment_reacted', $3, 'user', $2, $4, $5, $6)`,
      [notificationId, owner.userId, category, randomUUID(), createdAt, readAt],
    );

    return notificationId;
  };

  describe("spent proofs", () => {
    it("removes a consumed sign-in link and keeps a live one", async () => {
      const consumed = randomUUID();
      const live = randomUUID();

      for (const [token, consumedAt, expiresIn] of [
        [consumed, ago(2), "-1 hour"],
        [live, null, "1 hour"],
      ] as const) {
        await connection.dataSource.query(
          `INSERT INTO magic_link_tokens
             (token_hash, email, purpose, expires_at, consumed_at, created_at)
           VALUES ($1, $2, 'login', now() + $3::interval, $4, $5)`,
          [token, `${token}@example.test`, expiresIn, consumedAt, ago(2)],
        );
      }

      await sweep();

      assert.equal(await countWhere("magic_link_tokens", "token_hash", consumed), 0);
      assert.equal(await countWhere("magic_link_tokens", "token_hash", live), 1, "unconsumed");
    });
  });

  describe("notifications", () => {
    it("removes a read one before an unread one of the same age", async () => {
      const read = await notification("social", ago(60), ago(60));
      const unread = await notification("social", ago(60), null);

      // Short enough to catch the read one, long enough to spare the unread.
      await sweep({ ...TEST_RETENTION_PERIODS, readNotifications: 30 });

      assert.equal(await countWhere("notifications", "notification_id", read), 0);
      assert.equal(await countWhere("notifications", "notification_id", unread), 1);
    });

    it("keeps a required one longest of all", async () => {
      const social = await notification("social", ago(400), null);
      const moderation = await notification("moderation", ago(400), null);
      const security = await notification("security", ago(400), null);

      await sweep({ ...TEST_RETENTION_PERIODS, notifications: 180 });

      // A moderation notification carries a right of appeal, and a security one
      // is the record that somebody was told their account changed.
      assert.equal(await countWhere("notifications", "notification_id", social), 0);
      assert.equal(await countWhere("notifications", "notification_id", moderation), 1);
      assert.equal(await countWhere("notifications", "notification_id", security), 1);
    });

    it("removes the actors with the notification", async () => {
      const notificationId = await notification("social", ago(400), null);

      await connection.dataSource.query(
        `INSERT INTO notification_actors (notification_id, actor_user_id, acted_at)
         VALUES ($1, $2, now())`,
        [notificationId, owner.userId],
      );

      await sweep({ ...TEST_RETENTION_PERIODS, notifications: 180 });

      assert.equal(await countWhere("notification_actors", "notification_id", notificationId), 0);
    });

    it("sweeps the deduplication table, which nothing cascades to", async () => {
      const sourceEventId = randomUUID();

      await connection.dataSource.query(
        `INSERT INTO notification_source_events (source_event_id, recipient_user_id, handled_at)
         VALUES ($1, $2, $3)`,
        [sourceEventId, owner.userId, ago(90)],
      );

      await sweep({ ...TEST_RETENTION_PERIODS, notificationDeduplication: 30 });

      // It references `users` and not `notifications`, so every notification
      // sweep leaves it untouched and it would otherwise grow without limit.
      assert.equal(
        await countWhere("notification_source_events", "source_event_id", sourceEventId),
        0,
      );
    });

    it("never removes a delivery still waiting to go", async () => {
      const notificationId = await notification("social", ago(400), null);
      const pending = randomUUID();

      await connection.dataSource.query(
        `INSERT INTO notification_deliveries
           (delivery_id, notification_id, recipient_user_id, channel, mode, status, due_at,
            attempts, created_at)
         VALUES ($1, $2, $3, 'email', 'immediate', 'pending', now(), 0, $4)`,
        [pending, notificationId, owner.userId, ago(400)],
      );

      await sweep({ ...TEST_RETENTION_PERIODS, deliveryRecords: 0 });

      assert.equal(await countWhere("notification_deliveries", "delivery_id", pending), 1);
    });
  });

  describe("devices", () => {
    /**
     * A device registered long ago, last seen when the caller says.
     *
     * The two timestamps differ deliberately. An earlier version set both to
     * one value, which meant the rule could have judged a device by when it was
     * registered instead of when it last reported in and every test would still
     * have passed.
     */
    const device = async (lastSeen: Date, status = "active"): Promise<string> => {
      const deviceId = randomUUID();

      await connection.dataSource.query(
        `INSERT INTO notification_devices
           (device_id, user_id, platform, token, status, registered_at, last_seen_at,
            invalidated_at)
         VALUES ($1, $2, 'ios', $3, $4, $5, $6, $7)`,
        [
          deviceId,
          owner.userId,
          `tok-${deviceId}`,
          status,
          ago(1_000),
          lastSeen,
          status === "invalidated" ? lastSeen : null,
        ],
      );

      return deviceId;
    };

    it("retires one that has gone quiet, rather than removing it", async () => {
      const dormant = await device(ago(400));

      await sweep({ ...TEST_RETENTION_PERIODS, dormantDevices: 180 });

      const rows: { status: string; invalidated_at: Date | null }[] =
        await connection.dataSource.query(
          `SELECT status, invalidated_at FROM notification_devices WHERE device_id = $1`,
          [dormant],
        );

      // The retired row is what distinguishes a dead token from one that was
      // never registered, so it has to outlive the retirement.
      assert.equal(rows[0]?.status, "invalidated");
      assert.notEqual(rows[0]?.invalidated_at, null);
    });

    it("leaves one that reported in recently", async () => {
      const active = await device(ago(1));

      await sweep({ ...TEST_RETENTION_PERIODS, dormantDevices: 180 });

      const rows: { status: string }[] = await connection.dataSource.query(
        `SELECT status FROM notification_devices WHERE device_id = $1`,
        [active],
      );

      assert.equal(rows[0]?.status, "active");
    });

    it("removes one retired long enough ago", async () => {
      const retired = await device(ago(90), "invalidated");

      await sweep({ ...TEST_RETENTION_PERIODS, retiredDevices: 30 });

      assert.equal(await countWhere("notification_devices", "device_id", retired), 0);
    });
  });

  describe("audit events", () => {
    it("removes old ones and keeps recent ones", async () => {
      const old = randomUUID();
      const recent = randomUUID();

      for (const [id, occurredAt] of [[old, ago(800)], [recent, ago(10)]] as const) {
        await connection.dataSource.query(
          `INSERT INTO auth_audit_events (id, occurred_at, event_type, outcome)
           VALUES ($1, $2, 'session_created', 'success')`,
          [id, occurredAt],
        );
      }

      await sweep({ ...TEST_RETENTION_PERIODS, auditEvents: 730 });

      assert.equal(await countWhere("auth_audit_events", "id", old), 0);
      assert.equal(await countWhere("auth_audit_events", "id", recent), 1);
    });
  });

  describe("uploads", () => {
    const upload = async (state: string, expiresAt: Date, withObject = true): Promise<string> => {
      const uploadId = randomUUID();
      const key = `${uploadPrefix(owner.userId, uploadId)}/original`;

      await connection.dataSource.query(
        `INSERT INTO uploads (
           upload_id, owner_user_id, kind, declared_content_type, declared_byte_size,
           storage_key, state, registered_at, expires_at, updated_at)
         VALUES ($1, $2, 'image', 'image/jpeg', 1024, $3, $4, now(), $5, $5)`,
        [uploadId, owner.userId, key, state, expiresAt],
      );

      if (withObject) {
        await storage.put(key, new Uint8Array([1, 2, 3]), "image/jpeg");
      }

      return uploadId;
    };

    it("erases a registration that was never finished, objects included", async () => {
      const abandoned = await upload("registered", ago(2));
      const prefix = uploadPrefix(owner.userId, abandoned);

      assert.equal((await storage.list(prefix)).length, 1, "written");

      await sweep();

      // Asserted against storage rather than against the last pass's count.
      // Draining means the final pass erased nothing by definition, so a count
      // taken from it would be zero however well the sweep worked.
      assert.deepEqual(await storage.list(prefix), []);

      // The row goes on a later pass, not this one. Erasing stamps `updated_at`
      // with the moment it happened, which is after the cutoff this pass is
      // measuring against — so the row is not yet old enough to sweep. The same
      // two stages as everywhere else in this phase: the bytes go first, and
      // the record of them follows.
      assert.equal(await countWhere("uploads", "upload_id", abandoned), 1, "the row, for now");

      await sweep();

      assert.equal(await countWhere("uploads", "upload_id", abandoned), 0, "and now the row");
    });

    it("never touches one a Moment still holds", async () => {
      const held = await upload("ready", ago(400));
      const momentId = randomUUID();

      await connection.dataSource.query(
        `INSERT INTO moments (moment_id, author_user_id, caption, occurrence_start,
                              occurrence_end, occurrence_precision, occurrence_offset_minutes,
                              visibility)
         VALUES ($1, $2, 'a caption', now(), now(), 'instant', 0, 'public')`,
        [momentId, owner.userId],
      );
      await connection.dataSource.query(
        `INSERT INTO moment_media (moment_id, upload_id, position) VALUES ($1, $2, 0)`,
        [momentId, held],
      );

      await sweep();

      // History, however old the registration was.
      assert.equal(await countWhere("uploads", "upload_id", held), 1);
      assert.deepEqual(
        (await storage.list(uploadPrefix(owner.userId, held))).length,
        1,
      );
    });

    it("keeps the row of an erased upload a Moment still references", async () => {
      const erased = await upload("deleted", ago(400), false);
      const momentId = randomUUID();

      await connection.dataSource.query(
        `INSERT INTO moments (moment_id, author_user_id, caption, occurrence_start,
                              occurrence_end, occurrence_precision, occurrence_offset_minutes,
                              visibility)
         VALUES ($1, $2, 'a caption', now(), now(), 'instant', 0, 'public')`,
        [momentId, owner.userId],
      );
      await connection.dataSource.query(
        `INSERT INTO moment_media (moment_id, upload_id, position) VALUES ($1, $2, 0)`,
        [momentId, erased],
      );

      await sweep({ ...TEST_RETENTION_PERIODS, privacyRequests: 0 });

      // The foreign key would refuse the delete, but refusing is not the same
      // as not attempting: a statement that threw would abandon the whole batch
      // and leave every other row in it unswept.
      assert.equal(await countWhere("uploads", "upload_id", erased), 1);
    });

    it("removes the row of one whose bytes have already gone", async () => {
      const erased = await upload("deleted", ago(400), false);

      await sweep({ ...TEST_RETENTION_PERIODS, privacyRequests: 0 });

      assert.equal(await countWhere("uploads", "upload_id", erased), 0);
    });
  });

  describe("bounded and repeatable", () => {
    it("takes several passes when there is more than one batch", async () => {
      for (let index = 0; index < 5; index += 1) {
        await notification("social", ago(400), null);
      }

      const periods = { ...TEST_RETENTION_PERIODS, notifications: 180 };
      const rule = RETENTION_SCHEDULE.find((one) => one.name === "ordinary notifications");

      assert.notEqual(rule, undefined);

      // Asked of one rule directly rather than of the whole schedule. The
      // property is that a sweep never exceeds its batch, and asserting it
      // through every rule at once made the test depend on how many rows other
      // suites had left behind — which is how it passed on a full database and
      // failed on a drained one.
      let passes = 0;

      for (; passes < 50; passes += 1) {
        const result = await retention.apply(rule!, periods, 2);

        assert.ok(result.removed <= 2, `removed ${result.removed} with a batch of two`);

        if (result.reachedEnd) {
          break;
        }
      }

      // Five rows and a batch of two cannot be done in one pass, whatever else
      // is in the table.
      assert.ok(passes >= 2, `finished in ${passes} passes`);
      assert.equal(await countWhere("notifications", "recipient_user_id", owner.userId), 0);
    });

    it("removes nothing the second time", async () => {
      await notification("social", ago(400), null);

      await sweep({ ...TEST_RETENTION_PERIODS, notifications: 180 });

      const again = await sweep({ ...TEST_RETENTION_PERIODS, notifications: 180 });

      assert.equal(again.swept["ordinary notifications"], 0);
    });
  });

  describe("what retention must never touch", () => {
    it("leaves every kind of history standing, even with nothing retained", async () => {
      const momentId = randomUUID();
      const commentId = randomUUID();

      await connection.dataSource.query(
        `INSERT INTO moments (moment_id, author_user_id, caption, occurrence_start,
                              occurrence_end, occurrence_precision, occurrence_offset_minutes,
                              visibility, created_at)
         VALUES ($1, $2, 'a caption', now(), now(), 'instant', 0, 'public', $3)`,
        [momentId, owner.userId, ago(4_000)],
      );
      await connection.dataSource.query(
        `INSERT INTO moment_comments (comment_id, moment_id, author_user_id, body, created_at)
         VALUES ($1, $2, $3, 'something said', $4)`,
        [commentId, momentId, owner.userId, ago(4_000)],
      );
      await connection.dataSource.query(
        `INSERT INTO moment_reactions (moment_id, user_id, kind, created_at)
         VALUES ($1, $2, 'loved', $3)`,
        [momentId, owner.userId, ago(4_000)],
      );
      await connection.dataSource.query(
        `INSERT INTO moment_edits (edit_id, moment_id, edited_by_user_id, kind, previous, edited_at)
         VALUES ($1, $2, $3, 'caption_changed', '{}'::jsonb, $4)`,
        [randomUUID(), momentId, owner.userId, ago(4_000)],
      );
      await connection.dataSource.query(
        `INSERT INTO moderation_states (subject_type, subject_id, state, reason, decided_at)
         VALUES ('moment', $1, 'warned', 'integration test', $2)`,
        [momentId, ago(4_000)],
      );

      // Every period at zero: the most destructive configuration the system
      // permits. A product built to preserve decades does not expire them.
      await sweep(NOTHING_RETAINED);

      assert.equal(await countWhere("moments", "moment_id", momentId), 1, "the Moment");
      assert.equal(await countWhere("moment_comments", "comment_id", commentId), 1, "its comment");
      assert.equal(await countWhere("moment_reactions", "moment_id", momentId), 1, "its reactions");
      assert.equal(await countWhere("moment_edits", "moment_id", momentId), 1, "its history");
      assert.equal(
        await countWhere("moderation_states", "subject_id", momentId),
        1,
        "what was decided about it",
      );
    });

    it("names no table that holds anything anybody recorded", async () => {
      // Asked of the database rather than of the schedule, so that a rule
      // naming a table added later is caught by what that table is rather than
      // by a list somebody remembered to update.
      const rows: { table_name: string }[] = await connection.dataSource.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public'
            AND (table_name LIKE 'moment%' OR table_name LIKE 'moderation%'
                 OR table_name IN ('locations', 'real_world_events', 'users', 'user_handles',
                                   'comment_reactions', 'comment_mentions', 'accuracy_reports'))`,
      );
      const history = new Set(rows.map((row) => row.table_name));

      for (const rule of RETENTION_SCHEDULE) {
        assert.equal(history.has(rule.table), false, `${rule.name} sweeps ${rule.table}`);
      }
    });
  });
});
