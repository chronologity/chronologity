import assert from "node:assert/strict";
import { testContext } from "../../testing/context.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { AppConfig } from "../../config/app-config.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { withTransaction } from "../../lib/database/transaction.js";
import { createStorageClient } from "../../integrations/storage/storage-client.js";
import type { StorageClient } from "../../integrations/storage/storage-client.js";
import {
  createLocation,
  createRealWorldEvent,
  createUser,
} from "../../testing/fixtures.js";
import { eraseDueRequests } from "../../workers/erasure/erase.js";
import { LocationRepository } from "../locations/location.repository.js";
import { ModerationRepository } from "../moderation/moderation.repository.js";
import { MomentCommentRepository } from "../moments/moment-comment.repository.js";
import { MomentCommentService } from "../moments/moment-comment.service.js";
import { MomentRepository } from "../moments/moment.repository.js";
import { MomentService } from "../moments/moment.service.js";
import { RealWorldEventRepository } from "../real-world-events/real-world-event.repository.js";
import { NotificationRepository } from "../notifications/notification.repository.js";
import { NotificationService } from "../notifications/notification.service.js";
import { INDEX_VERSION } from "../search/search-document.js";
import { SearchIndexer } from "../search/search.indexer.js";
import { SearchSourceRepository } from "../search/search-source.repository.js";
import { SearchRepository } from "../search/search.repository.js";
import { TimelineProjector } from "../timeline/timeline.projector.js";
import { rebuildTimeline } from "../timeline/timeline.rebuild.js";
import { TimelineRepository } from "../timeline/timeline.repository.js";
import { TimelineSourceRepository } from "../timeline/timeline-source.repository.js";
import { createAnalytics, type Analytics } from "../../lib/clickhouse/clickhouse.js";
import { migrateAnalytics } from "../../lib/clickhouse/migrations.js";
import { testAppConfig } from "../../testing/app-config.js";
import { FollowRepository } from "../social/follow.repository.js";
import { UploadRepository } from "../uploads/upload.repository.js";
import { UploadService } from "../uploads/upload.service.js";
import { UserRepository } from "../users/user.repository.js";
import { AccountErasureRepository } from "./account-erasure.repository.js";
import { ErasureRepository } from "./erasure.repository.js";
import { uploadPrefix } from "../uploads/upload.storage-key.js";

/**
 * Erasure, against real infrastructure.
 *
 * The claims this suite has to establish are not claims about behaviour a user
 * observes — deleting a Moment already made it disappear. They are claims about
 * what is left behind afterwards, so almost every assertion here reads the
 * database or the object store directly rather than an API response. A test
 * that asked the product whether something was gone would be asking the wrong
 * question: the product said it was gone before any of this ran.
 *
 * Requires `pnpm infra:up`.
 */

const config: AppConfig["database"] = {
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? "5432"),
  database: process.env.POSTGRES_DATABASE ?? "chronologity",
  user: process.env.POSTGRES_USER ?? "chronologity",
  password: process.env.POSTGRES_PASSWORD ?? "chronologity",
};

const storageConfig = {
  endpoint: process.env.S3_ENDPOINT ?? "http://127.0.0.1:8333",
  region: process.env.S3_REGION ?? "us-east-1",
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "chronologity",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "chronologity-local-secret",
  bucket: process.env.S3_BUCKET ?? "chronologity-media",
  forcePathStyle: true,
  uploadUrlTtlSeconds: 900,
};

const uploadLimits = {
  registrationTtlSeconds: 3_600,
  maxImageBytes: 26_214_400,
  maxVideoBytes: 524_288_000,
};

const occurrence = {
  start: "1998-06-01T00:00:00.000Z",
  end: "1998-06-01T00:00:00.000Z",
  precision: "instant",
} as const;

describe("erasure", () => {
  let database: Database;
  let storage: StorageClient;
  let moments: MomentService;
  let comments: MomentCommentService;
  let erasures: ErasureRepository;
  let momentRepository: MomentRepository;
  let documents: SearchRepository;
  let analytics: Analytics;
  let timeline: TimelineRepository;
  let projector: TimelineProjector;
  const timelineVersion = `test-${randomUUID().slice(0, 8)}`;
  let uploads: UploadService;
  let commentRepository: MomentCommentRepository;
  let accountErasure: AccountErasureRepository;

  /** Set to make the next object-storage removal fail. */
  let storageRefuses: Error | undefined;

  beforeAll(async () => {
    database = createDatabase(config);
    await connectDatabase(database);
    await migrate(database.dataSource);

    const real = createStorageClient(storageConfig);

    storage = {
      ...real,
      presignUpload: (key, contentType) => real.presignUpload(key, contentType),
      presignDownload: (key, seconds) => real.presignDownload(key, seconds),
      head: (key) => real.head(key),
      put: (key, body, contentType) => real.put(key, body, contentType),
      list: (prefix) => real.list(prefix),
      remove: async (key) => {
        if (storageRefuses !== undefined) {
          throw storageRefuses;
        }

        return real.remove(key);
      },
    };

    momentRepository = new MomentRepository(database.dataSource);
    erasures = new ErasureRepository(database.dataSource);
    documents = new SearchRepository(database.dataSource);

    analytics = createAnalytics(testAppConfig("erasure-integration").clickhouse);
    await migrateAnalytics(analytics.client);
    timeline = new TimelineRepository(analytics.client, timelineVersion);
    projector = new TimelineProjector(
      database.dataSource,
      timeline,
      new TimelineSourceRepository(database.dataSource),
    );

    uploads = new UploadService(
      database.dataSource,
      new UploadRepository(database.dataSource),
      storage,
      uploadLimits,
      {},
    );

    commentRepository = new MomentCommentRepository(database.dataSource);
    accountErasure = new AccountErasureRepository(database.dataSource);

    moments = new MomentService(
      database.dataSource,
      momentRepository,
      new UploadRepository(database.dataSource),
      new LocationRepository(database.dataSource),
      new RealWorldEventRepository(database.dataSource),
      new FollowRepository(database.dataSource),
      new UserRepository(database.dataSource),
      new ModerationRepository(database.dataSource),
      commentRepository,
      erasures,
    );

    comments = new MomentCommentService(
      database.dataSource,
      commentRepository,
      new MomentRepository(database.dataSource),
      moments,
      new FollowRepository(database.dataSource),
      new UserRepository(database.dataSource),
    );
  });

  afterAll(async () => {
    // A projection version of its own, removed at the end: the table is shared,
    // and a version left behind accumulates the way stale search rows once did.
    await analytics.client.command({
      query: `DELETE FROM timeline_moments WHERE projection_version = {version: String}`,
      query_params: { version: timelineVersion },
    });
    await analytics.client.command({
      query: `DELETE FROM timeline_moment_contexts WHERE projection_version = {version: String}`,
      query_params: { version: timelineVersion },
    });
    await analytics.close();
    await database.close();
  });

  /** An upload row with real objects behind it, at the prefix erasure sweeps. */
  const uploadWithObjects = async (ownerUserId: string): Promise<string> => {
    const uploadId = randomUUID();
    const prefix = uploadPrefix(ownerUserId, uploadId);

    await database.dataSource.query(
      `INSERT INTO uploads (
         upload_id, owner_user_id, kind, declared_content_type, declared_byte_size,
         storage_key, state, media_kind, byte_size, content_type,
         width, height, checked_at, registered_at, expires_at, updated_at
       ) VALUES ($1, $2, 'image', 'image/jpeg', 1024, $3, 'ready', 'image', 1024, 'image/jpeg',
                 100, 100, now(), now(), now() + interval '1 hour', now())`,
      [uploadId, ownerUserId, `${prefix}/original`],
    );

    // An original and a derivative, so the assertion that derived copies go too
    // is about a derived copy that actually existed.
    await storage.put(`${prefix}/original`, new Uint8Array([1, 2, 3]), "image/jpeg");
    await storage.put(`${prefix}/thumbnail.jpg`, new Uint8Array([4, 5, 6]), "image/jpeg");

    return uploadId;
  };

  const record = async (
    authorUserId: string,
    caption: string,
    uploadIds: readonly string[],
  ): Promise<string> => {
    const moment = await moments.record(authorUserId, {
      caption,
      occurrence,
      occurrenceOffsetMinutes: 0,
      uploadIds: [...uploadIds],
      visibility: "public",
      locationDisclosure: "exact",
    } as never, testContext());

    return moment.momentId;
  };

  /** Record a Moment that belongs to a place, an occasion, or both. */
  const recordWithin = async (
    authorUserId: string,
    uploadIds: readonly string[],
    scopes: { locationId?: string; realWorldEventIds?: string[] },
  ): Promise<string> => {
    const moment = await moments.record(
      authorUserId,
      {
        caption: "somewhere in particular",
        occurrence,
        occurrenceOffsetMinutes: 0,
        uploadIds: [...uploadIds],
        visibility: "public",
        locationDisclosure: "exact",
        ...scopes,
      } as never,
      testContext(),
    );

    return moment.momentId;
  };

  /**
   * How many scopes the projection still says a Moment belonged to.
   *
   * Raw rows rather than merged ones. Erasure must leave none at all, and
   * `final = 1` would hide a row a merge had not yet folded away.
   */
  const contextCount = async (momentId: string): Promise<number> => {
    const result = await analytics.client.query({
      query: `SELECT count() AS count FROM timeline_moment_contexts
               WHERE moment_id = {momentId: String} AND projection_version = {version: String}`,
      query_params: { momentId, version: timelineVersion },
      format: "JSONEachRow",
    });
    const rows = await result.json<{ count: string }>();

    return Number(rows[0]?.count ?? 0);
  };

  /** Run the worker until nothing is due, as the worker process itself does. */
  const erase = async () => {
    let last = await eraseDueRequests({
      dataSource: database.dataSource,
      erasures,
      moments: momentRepository,
      comments: commentRepository,
      accounts: accountErasure,
      storage,
      uploads,
      documents,
      indexVersion: INDEX_VERSION,
      timeline,
    });

    for (let pass = 0; pass < 50 && !last.reachedEnd; pass += 1) {
      last = await eraseDueRequests({
        dataSource: database.dataSource,
        erasures,
        moments: momentRepository,
        comments: commentRepository,
        accounts: accountErasure,
        storage,
        uploads,
        documents,
        indexVersion: INDEX_VERSION,
        timeline,
      });
    }

    return last;
  };

  const rowsFor = async (table: string, momentId: string): Promise<number> => {
    const rows: { count: string }[] = await database.dataSource.query(
      `SELECT COUNT(*) AS count FROM ${table} WHERE moment_id = $1`,
      [momentId],
    );

    return Number(rows[0]?.count ?? "0");
  };

  const requestFor = async (momentId: string) =>
    erasures.findLatest("moment", momentId);

  describe("marking", () => {
    it("blanks the caption before the worker has run at all", async () => {
      const author = await createUser(database.dataSource);
      const caption = `zq${randomUUID().replaceAll("-", "")}`;
      const momentId = await record(author.userId, caption, [
        await uploadWithObjects(author.userId),
      ]);

      await moments.delete(momentId, author.userId, testContext());

      const rows: { caption: string }[] = await database.dataSource.query(
        `SELECT caption FROM moments WHERE moment_id = $1`,
        [momentId],
      );

      // Erasure is a queue and a queue can back up. What waits in it should be
      // structure rather than what somebody wrote.
      assert.equal(rows[0]?.caption, "");
    });

    it("blanks other people's comments at the same instant", async () => {
      const author = await createUser(database.dataSource);
      const talker = await createUser(database.dataSource);
      const momentId = await record(author.userId, "a caption", [
        await uploadWithObjects(author.userId),
      ]);
      const said = `zq${randomUUID().replaceAll("-", "")}`;

      await comments.add(momentId, talker.userId, { body: said } as never);
      await moments.delete(momentId, author.userId, testContext());

      const rows: { body: string }[] = await database.dataSource.query(
        `SELECT body FROM moment_comments WHERE moment_id = $1`,
        [momentId],
      );

      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.body, "");
    });

    it("records the erasure still owed", async () => {
      const author = await createUser(database.dataSource);
      const momentId = await record(author.userId, "a caption", [
        await uploadWithObjects(author.userId),
      ]);

      await moments.delete(momentId, author.userId, testContext());

      const request = await requestFor(momentId);

      assert.equal(request?.state, "pending");
      assert.equal(request?.attempts, 0);
    });

    it("opens one request however often deletion is asked for", async () => {
      const author = await createUser(database.dataSource);
      const momentId = await record(author.userId, "a caption", [
        await uploadWithObjects(author.userId),
      ]);

      await moments.delete(momentId, author.userId, testContext());
      await assert.rejects(() => moments.delete(momentId, author.userId, testContext()));

      const rows: { count: string }[] = await database.dataSource.query(
        `SELECT COUNT(*) AS count FROM erasure_requests WHERE subject_id = $1`,
        [momentId],
      );

      assert.equal(rows[0]?.count, "1");
    });
  });

  describe("erasing", () => {
    it("removes the row and everything that hung off it", async () => {
      const author = await createUser(database.dataSource);
      const talker = await createUser(database.dataSource);
      const momentId = await record(author.userId, "a caption", [
        await uploadWithObjects(author.userId),
      ]);

      await comments.add(momentId, talker.userId, { body: "something said" } as never);
      await moments.delete(momentId, author.userId, testContext());
      await erase();

      const rows: { count: string }[] = await database.dataSource.query(
        `SELECT COUNT(*) AS count FROM moments WHERE moment_id = $1`,
        [momentId],
      );

      assert.equal(rows[0]?.count, "0", "the row");
      assert.equal(await rowsFor("moment_media", momentId), 0, "media links");
      assert.equal(await rowsFor("moment_comments", momentId), 0, "comments");
      assert.equal(await rowsFor("moment_reactions", momentId), 0, "reactions");
      assert.equal(await rowsFor("moment_audience", momentId), 0, "audience");
      assert.equal(await rowsFor("moment_edits", momentId), 0, "edit history");
      assert.equal(await rowsFor("moment_participations", momentId), 0, "participations");
    });

    it("removes the objects, derived copies included", async () => {
      const author = await createUser(database.dataSource);
      const uploadId = await uploadWithObjects(author.userId);
      const prefix = uploadPrefix(author.userId, uploadId);
      const momentId = await record(author.userId, "a caption", [uploadId]);

      assert.equal((await storage.list(prefix)).length, 2, "before");

      await moments.delete(momentId, author.userId, testContext());
      await erase();

      // A product cannot truthfully claim a video was deleted while continuing
      // to serve a transcoded copy.
      assert.deepEqual(await storage.list(prefix), []);
    });

    it("removes the search document without waiting for the indexer", async () => {
      const author = await createUser(database.dataSource);
      const momentId = await record(author.userId, "a caption", [
        await uploadWithObjects(author.userId),
      ]);

      await withTransaction(database.dataSource, (tx) =>
        documents.upsert(
          tx,
          INDEX_VERSION,
          {
            entityType: "moment",
            entityId: momentId,
            title: "a caption",
            body: "a caption",
            aliases: "",
            occurrenceStart: new Date(occurrence.start),
            occurrenceEnd: new Date(occurrence.end),
            occurrencePrecision: "instant",
            publishedAt: new Date(),
            visibility: "public",
            searchable: true,
            moderationState: "allowed",
            deleted: false,
            discoverable: true,
            authorUserId: author.userId,
            geohashExact: null,
            geohashCoarse: null,
            geohashRegion: null,
            significance: null,
            significanceVersion: null,
            provenance: {},
          },
          new Date(),
          undefined,
        ),
      );

      assert.notEqual(await documents.find(INDEX_VERSION, "moment", momentId), undefined);

      await moments.delete(momentId, author.userId, testContext());
      await erase();

      assert.equal(await documents.find(INDEX_VERSION, "moment", momentId), undefined);
    });

    it("marks the request completed", async () => {
      const author = await createUser(database.dataSource);
      const momentId = await record(author.userId, "a caption", [
        await uploadWithObjects(author.userId),
      ]);

      await moments.delete(momentId, author.userId, testContext());
      await erase();

      const request = await requestFor(momentId);

      assert.equal(request?.state, "completed");
      assert.notEqual(request?.completedAt, null);
    });

    it("erases every upload a Moment held", async () => {
      const author = await createUser(database.dataSource);
      const uploadIds = [
        await uploadWithObjects(author.userId),
        await uploadWithObjects(author.userId),
        await uploadWithObjects(author.userId),
      ];
      const momentId = await record(author.userId, "a caption", uploadIds);

      await moments.delete(momentId, author.userId, testContext());
      await erase();

      for (const uploadId of uploadIds) {
        assert.deepEqual(
          await storage.list(uploadPrefix(author.userId, uploadId)),
          [],
          uploadId,
        );
      }
    });

    it("erases once however often the worker runs", async () => {
      const author = await createUser(database.dataSource);
      const momentId = await record(author.userId, "a caption", [
        await uploadWithObjects(author.userId),
      ]);

      await moments.delete(momentId, author.userId, testContext());

      const first = await erase();

      assert.ok(first.erased >= 1);

      const second = await erase();

      assert.equal(second.failed, 0, "a second run does not fail on what has gone");
      assert.equal((await requestFor(momentId))?.state, "completed");
    });
  });

  describe("what erasure must not touch", () => {
    it("spares an upload another living Moment still holds", async () => {
      const author = await createUser(database.dataSource);
      const uploadId = await uploadWithObjects(author.userId);
      const doomed = await record(author.userId, "the one being deleted", [uploadId]);
      const kept = await record(author.userId, "the one that stays", [uploadId]);

      await moments.delete(doomed, author.userId, testContext());
      await erase();

      // Nothing prevents attaching one upload twice, and erasure declines to
      // destroy bytes something living still points at rather than deciding
      // whether that ought to be possible.
      assert.equal((await storage.list(uploadPrefix(author.userId, uploadId))).length, 2);

      const still = await moments.get(kept, author.userId);

      assert.equal(still.momentId, kept);
    });

    it("erases an upload only other deleted Moments held", async () => {
      const author = await createUser(database.dataSource);
      const uploadId = await uploadWithObjects(author.userId);
      const first = await record(author.userId, "one", [uploadId]);
      const second = await record(author.userId, "two", [uploadId]);

      await moments.delete(first, author.userId, testContext());
      await moments.delete(second, author.userId, testContext());
      await erase();

      // Both are awaiting erasure. If each deferred to the other the bytes
      // would outlive both.
      assert.deepEqual(await storage.list(uploadPrefix(author.userId, uploadId)), []);
    });

    it("leaves a Moment it was merely related to alone", async () => {
      const author = await createUser(database.dataSource);
      const doomed = await record(author.userId, "the one being deleted", [
        await uploadWithObjects(author.userId),
      ]);
      const other = await record(author.userId, "an unrelated one", [
        await uploadWithObjects(author.userId),
      ]);

      await moments.delete(doomed, author.userId, testContext());
      await erase();

      const still = await moments.get(other, author.userId);

      assert.equal(still.momentId, other);
    });

    it("leaves moderation records about it standing", async () => {
      const author = await createUser(database.dataSource);
      const momentId = await record(author.userId, "a caption", [
        await uploadWithObjects(author.userId),
      ]);

      await database.dataSource.query(
        `INSERT INTO moderation_states (subject_type, subject_id, state, reason, decided_by_user_id)
         VALUES ('moment', $1, 'warned', 'integration test', $2)`,
        [momentId, author.userId],
      );

      await moments.delete(momentId, author.userId, testContext());
      await erase();

      const rows: { count: string }[] = await database.dataSource.query(
        `SELECT COUNT(*) AS count FROM moderation_states WHERE subject_id = $1`,
        [momentId],
      );

      // 5N gave people a right of appeal, and an appeal against a decision
      // whose record vanished with the content is not one.
      assert.equal(rows[0]?.count, "1");
    });
  });

  describe("what erasure must leave nowhere", () => {
    it("takes the Moment off the Timeline", async () => {
      // The obligation the roadmap attaches to Phase 7 in plain terms: every
      // projection built there joins the erasure path, in the sub-phase that
      // creates it rather than a later one. A projection erasure cannot reach
      // is not ready to hold personal history, however well it performs.
      const author = await createUser(database.dataSource);
      const momentId = await record(author.userId, "a caption", [
        await uploadWithObjects(author.userId),
      ]);

      await projector.project(momentId);
      assert.notEqual(await timeline.find(momentId), undefined, "nothing to erase");

      await moments.delete(momentId, author.userId, testContext());
      await erase();

      assert.equal(await timeline.find(momentId), undefined, "the Timeline still holds it");
    });

    it("erases it from a projection version nobody is pointed at", async () => {
      // The hole that being able to configure a version would otherwise open.
      // A cutover means two versions of the same derived store standing at
      // once; erasure scoped to the configured one would leave the Moment in
      // the other, and it would come back the moment readers were switched —
      // with nothing anywhere saying so.
      //
      // Written through a second repository on a different version, which is
      // exactly what a half-finished cutover leaves behind.
      const author = await createUser(database.dataSource);
      const momentId = await record(author.userId, "a caption", [
        await uploadWithObjects(author.userId),
      ]);

      await projector.project(momentId);

      const otherVersion = new TimelineRepository(analytics.client, `${timelineVersion}-next`);
      const row = await timeline.find(momentId);

      assert.notEqual(row, undefined, "nothing to copy");

      await otherVersion.project({
        momentId,
        authorUserId: author.userId,
        occurredAt: new Date("1998-06-01T00:00:00.000Z"),
        recordedAt: new Date(),
        occurrenceEnd: new Date("1998-06-01T00:00:00.000Z"),
        occurrencePrecision: "day",
        occurrenceOffsetMinutes: 0,
        visibility: "public",
        moderationState: "allowed",
        discoverable: true,
      });

      assert.notEqual(await otherVersion.find(momentId), undefined, "nothing to erase");

      await moments.delete(momentId, author.userId, testContext());
      await erase();

      assert.equal(await timeline.find(momentId), undefined, "the live version still holds it");
      assert.equal(
        await otherVersion.find(momentId),
        undefined,
        "a version nobody was pointed at kept the Moment",
      );
    });

    it("takes the Moment out of the places and occasions it happened at", async () => {
      // A row saying "this Moment was here" outlives the Moment unless erasure
      // reaches it, and it is a record that the Moment existed and roughly
      // when — which is the thing erasure removes. It lives in a second table
      // keyed by scope rather than by Moment, so removing the Timeline row does
      // not remove it.
      const author = await createUser(database.dataSource);
      const locationId = await createLocation(database.dataSource, author.userId);
      const realWorldEventId = await createRealWorldEvent(database.dataSource, author.userId);
      const momentId = await recordWithin(
        author.userId,
        [await uploadWithObjects(author.userId)],
        { locationId, realWorldEventIds: [realWorldEventId] },
      );

      await projector.project(momentId);
      // The Location, the occasion, and the author, whose Timeline it is on.
      assert.equal(await contextCount(momentId), 3, "nothing to erase");

      await moments.delete(momentId, author.userId, testContext());
      await erase();

      assert.equal(await contextCount(momentId), 0, "the places still say it happened");
    });

    it("resists a replay: rebuilding the Timeline afterwards restores nothing", async () => {
      // The other half. Removing the row is worth little if the next rebuild
      // puts it back, which is why a rebuild reads authoritative state rather
      // than the event log — the Moment is gone from PostgreSQL, so there is
      // nothing to rebuild from.
      const author = await createUser(database.dataSource);
      const momentId = await record(author.userId, "a caption", [
        await uploadWithObjects(author.userId),
      ]);

      await projector.project(momentId);
      await moments.delete(momentId, author.userId, testContext());
      await erase();

      await rebuildTimeline(projector, new TimelineSourceRepository(database.dataSource), {
        only: [momentId],
      });

      assert.equal(await timeline.find(momentId), undefined, "a rebuild undid an erasure");
    });

    it("resists a replay: reindexing afterwards produces no document", async () => {
      const author = await createUser(database.dataSource);
      const momentId = await record(author.userId, "a caption", [
        await uploadWithObjects(author.userId),
      ]);

      await moments.delete(momentId, author.userId, testContext());
      await erase();

      const indexer = new SearchIndexer(
        database.dataSource,
        documents,
        new SearchSourceRepository(database.dataSource),
      );

      // Rebuild applies current eligibility rather than the eligibility that
      // existed when the history was written. The indexer reads authoritative
      // state, finds nothing, and removes rather than restoring.
      const outcome = await indexer.index("moment", momentId);

      assert.equal(outcome, "removed");
      assert.equal(await documents.find(INDEX_VERSION, "moment", momentId), undefined);
    });

    it("stops a notification about it from rendering", async () => {
      const author = await createUser(database.dataSource);
      const actor = await createUser(database.dataSource);
      const momentId = await record(author.userId, "a caption", [
        await uploadWithObjects(author.userId),
      ]);

      await database.dataSource.query(
        `INSERT INTO notifications
           (notification_id, recipient_user_id, type, category, source_type, source_id,
            aggregation_key, created_at)
         VALUES ($1, $2, 'moment_reacted', 'social', 'moment', $3, $4, now())`,
        [randomUUID(), author.userId, momentId, `${author.userId}:moment_reacted:${momentId}`],
      );
      await database.dataSource.query(
        `INSERT INTO notification_actors (notification_id, actor_user_id, acted_at)
         SELECT notification_id, $1, now() FROM notifications WHERE source_id = $2`,
        [actor.userId, momentId],
      );

      const notifications = new NotificationService(
        database.dataSource,
        new NotificationRepository(database.dataSource),
        moments,
        new UserRepository(database.dataSource),
        new FollowRepository(database.dataSource),
      );

      assert.equal((await notifications.list({ limit: 20, unreadOnly: false }, author.userId))
        .notifications.length, 1, "before");

      await moments.delete(momentId, author.userId, testContext());
      await erase();

      // Composition resolves access every time it renders, so a notification
      // about something erased leaves the list and the count without anything
      // having to propagate to it.
      const after = await notifications.list({ limit: 20, unreadOnly: false }, author.userId);

      assert.equal(after.notifications.length, 0);
      assert.equal((await notifications.unreadCount(author.userId)).unread, 0);
    });

    it("leaves the caption and the comment in no table at all", async () => {
      const author = await createUser(database.dataSource);
      const talker = await createUser(database.dataSource);
      const caption = `zq${randomUUID().replaceAll("-", "")}`;
      const said = `zq${randomUUID().replaceAll("-", "")}`;
      const momentId = await record(author.userId, caption, [
        await uploadWithObjects(author.userId),
      ]);

      await comments.add(momentId, talker.userId, { body: said } as never);
      await moments.delete(momentId, author.userId, testContext());
      await erase();

      // Every text column in the database, asked directly. The narrower tests
      // above name the tables they expect the words to have been in; this one
      // makes no assumption about where a future column might put them.
      const columns: { table_name: string; column_name: string }[] =
        await database.dataSource.query(
          `SELECT table_name, column_name
             FROM information_schema.columns
            WHERE table_schema = 'public' AND data_type IN ('text', 'character varying')`,
        );

      const found: string[] = [];

      for (const column of columns) {
        const rows: { count: string }[] = await database.dataSource.query(
          `SELECT COUNT(*) AS count FROM "${column.table_name}"
            WHERE "${column.column_name}" LIKE $1 OR "${column.column_name}" LIKE $2`,
          [`%${caption}%`, `%${said}%`],
        );

        if (Number(rows[0]?.count ?? "0") > 0) {
          found.push(`${column.table_name}.${column.column_name}`);
        }
      }

      assert.deepEqual(found, []);
    });
  });

  describe("when a store refuses", () => {
    it("leaves the request owed and tries again later", async () => {
      const author = await createUser(database.dataSource);
      const momentId = await record(author.userId, "a caption", [
        await uploadWithObjects(author.userId),
      ]);

      await moments.delete(momentId, author.userId, testContext());

      storageRefuses = new Error("the object store is unreachable");
      await erase();
      storageRefuses = undefined;

      const failed = await requestFor(momentId);

      assert.equal(failed?.state, "pending", "still owed");
      assert.equal(failed?.attempts, 1);
      assert.equal(failed?.errorCategory, "transient");

      // The Moment stays marked deleted throughout. A failed erasure never
      // restores what somebody asked to be gone.
      await assert.rejects(() => moments.get(momentId, author.userId));
    });

    it("finishes on a later run once the store recovers", async () => {
      const author = await createUser(database.dataSource);
      const uploadId = await uploadWithObjects(author.userId);
      const momentId = await record(author.userId, "a caption", [uploadId]);

      await moments.delete(momentId, author.userId, testContext());

      storageRefuses = new Error("the object store is unreachable");
      await erase();
      storageRefuses = undefined;

      // Past the lease, so the request is due again.
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
        timeline,
        now: () => new Date(Date.now() + 60 * 60 * 1_000),
      });

      assert.equal((await requestFor(momentId))?.state, "completed");
      assert.deepEqual(await storage.list(uploadPrefix(author.userId, uploadId)), []);
    });

    it("gives up rather than retrying forever", async () => {
      const author = await createUser(database.dataSource);
      const momentId = await record(author.userId, "a caption", [
        await uploadWithObjects(author.userId),
      ]);

      await moments.delete(momentId, author.userId, testContext());

      storageRefuses = new Error("the object store is unreachable");

      for (let round = 0; round < 2; round += 1) {
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
          timeline,
          maximumAttempts: 2,
          now: () => new Date(Date.now() + round * 60 * 60 * 1_000),
        });
      }

      storageRefuses = undefined;

      const request = await requestFor(momentId);

      // Retried forever is not retrying; it is a deletion nobody has been told
      // is incomplete.
      assert.equal(request?.state, "abandoned");
      assert.equal(request?.attempts, 2);
    });
  });
});
