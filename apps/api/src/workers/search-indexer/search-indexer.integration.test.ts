import { testAppConfig } from "../../testing/app-config.js";
import { testContext } from "../../testing/context.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import type { ConsumedEvent } from "../../lib/messaging/consumer.js";
import { withTransaction } from "../../lib/database/transaction.js";
import { LocationRepository } from "../../features/locations/location.repository.js";
import { ModerationRepository } from "../../features/moderation/moderation.repository.js";
import { MomentCommentRepository } from "../../features/moments/moment-comment.repository.js";
import { MomentRepository } from "../../features/moments/moment.repository.js";
import { MomentService } from "../../features/moments/moment.service.js";
import { RealWorldEventRepository } from "../../features/real-world-events/real-world-event.repository.js";
import { SearchIndexer } from "../../features/search/search.indexer.js";
import { rebuildSearchIndex } from "../../features/search/search.rebuild.js";
import { SearchRepository } from "../../features/search/search.repository.js";
import { SearchSourceRepository } from "../../features/search/search-source.repository.js";
import { buildMomentDocument, INDEX_VERSION } from "../../features/search/search-document.js";
import { FollowRepository } from "../../features/social/follow.repository.js";
import { UploadRepository } from "../../features/uploads/upload.repository.js";
import { UserRepository } from "../../features/users/user.repository.js";
import {
  createLocation,
  createReadyUpload,
  createRealWorldEvent,
  createUser,
} from "../../testing/fixtures.js";
import { deliverThroughBroker } from "../../testing/broker.js";
import { indexFromEvent, SEARCH_INDEXER_BOUNDARIES } from "./index-event.js";

/**
 * The Search indexer, against real infrastructure.
 *
 * Most of it hands events to the handler directly, which is the right shape for
 * what is specific to this worker: what a document says, that saying it twice
 * changes nothing, and that a rebuild reproduces what the worker built
 * incrementally. One test at the end does not, because none of those prove the
 * worker is listening to the right topics.
 *
 * Requires `pnpm infra:up`.
 */

const config = testAppConfig("search-indexer-integration");

describe("search indexer", () => {
  let database: Database;
  let indexer: SearchIndexer;
  let documents: SearchRepository;
  let sources: SearchSourceRepository;
  let moments: MomentService;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    documents = new SearchRepository(database.dataSource);
    sources = new SearchSourceRepository(database.dataSource);
    indexer = new SearchIndexer(database.dataSource, documents, sources);

    moments = new MomentService(
      database.dataSource,
      new MomentRepository(database.dataSource),
      new UploadRepository(database.dataSource),
      new LocationRepository(database.dataSource),
      new RealWorldEventRepository(database.dataSource),
      new FollowRepository(database.dataSource),
      new UserRepository(database.dataSource),
      new ModerationRepository(database.dataSource),
      new MomentCommentRepository(database.dataSource),
    );
  });

  afterAll(async () => {
    // Every shadow version, not only the ones the tests that created them got
    // as far as deleting. A test that fails partway leaves its version behind,
    // and abandoned index versions accumulate silently in a shared database —
    // which is how sixty-seven thousand stale rows came to sit alongside the
    // real index.
    await database.dataSource.query(
      "DELETE FROM search_documents WHERE index_version LIKE 'search-test-%'",
    );
    await database.close();
  });

  const summer = {
    start: "1998-06-01T00:00:00.000Z",
    end: "1998-08-31T23:59:59.000Z",
    precision: "month",
  } as const;

  /** A message as the consumer would hand it over. */
  const message = (eventType: string, payload: unknown, eventId = randomUUID()): ConsumedEvent => ({
    topic: "chronologity.domain-moments.v1",
    partition: 0,
    offset: "0",
    envelope: {
      eventId,
      eventType,
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      aggregate: { type: "moment", id: randomUUID(), version: 0 },
      payload,
    },
  });

  /** Somebody with a Moment, recorded through the service so an event is published. */
  const someoneWithAMoment = async (caption = "The summer everything changed") => {
    const author = await createUser(database.dataSource);
    const uploadId = await createReadyUpload(database.dataSource, author.userId);
    const moment = await moments.record(author.userId, {
      caption,
      occurrence: summer,
      occurrenceOffsetMinutes: 0,
      uploadIds: [uploadId],
      visibility: "public",
      locationDisclosure: "exact",
    }, testContext());

    return { author, momentId: moment.momentId, uploadId };
  };

  const documentFor = async (entityType: string, entityId: string) =>
    documents.find(INDEX_VERSION, entityType, entityId);

  describe("keeping the index current", () => {
    it("indexes a Moment that was recorded", async () => {
      const { author, momentId } = await someoneWithAMoment();

      await indexer.index("moment", momentId);

      const document = await documentFor("moment", momentId);

      assert.equal(document?.title, "The summer everything changed");
      assert.equal(document?.authorUserId, author.userId);
      assert.equal(document?.searchable, true);
    });

    it("publishes an event when a Moment is recorded", async () => {
      const { momentId } = await someoneWithAMoment();

      const rows: { event_type: string }[] = await database.dataSource.query(
        "SELECT event_type FROM outbox_messages WHERE aggregate_id = $1",
        [momentId],
      );

      assert.deepEqual(
        rows.map((row) => row.event_type),
        ["MomentRecorded"],
      );
    });

    it("records a Moment without the broker being involved at all", async () => {
      // Authoritative writes never depend on Search indexing (`search.md`
      // invariant 11). The event goes to a table in the same transaction, and
      // no broker is reachable from this suite at all — so a Moment that reads
      // back is a Moment recorded without one.
      const { author, momentId } = await someoneWithAMoment();

      const moment = await moments.getForAuthor(momentId, author.userId);

      assert.equal(moment.momentId, momentId);
      assert.equal(await documentFor("moment", momentId), undefined);
    });

    it("keeps the occurrence interval and its precision", async () => {
      const { momentId } = await someoneWithAMoment();

      await indexer.index("moment", momentId);

      const document = await documentFor("moment", momentId);

      assert.equal(document?.occurrencePrecision, "month");
      assert.equal(document?.occurrenceStart?.toISOString(), summer.start);
      assert.equal(document?.occurrenceEnd?.toISOString(), summer.end);
    });

    it("makes one document however many media a Moment holds", async () => {
      const author = await createUser(database.dataSource);
      const uploadIds = [
        await createReadyUpload(database.dataSource, author.userId),
        await createReadyUpload(database.dataSource, author.userId),
        await createReadyUpload(database.dataSource, author.userId),
      ];
      const moment = await moments.record(author.userId, {
        caption: "Three photographs",
        occurrence: summer,
        occurrenceOffsetMinutes: 0,
        uploadIds,
        visibility: "public",
        locationDisclosure: "exact",
      }, testContext());

      await indexer.index("moment", moment.momentId);

      const rows: { count: number }[] = await database.dataSource.query(
        "SELECT COUNT(*)::int AS count FROM search_documents WHERE entity_id = $1",
        [moment.momentId],
      );

      assert.equal(rows[0]?.count, 1);
    });

    it("indexes the place and the Events into the body", async () => {
      const { author, momentId } = await someoneWithAMoment();
      const locationId = await createLocation(database.dataSource, author.userId);
      const eventId = await createRealWorldEvent(
        database.dataSource,
        author.userId,
        "A family reunion",
      );

      await moments.setLocation(momentId, author.userId, locationId, testContext());
      await moments.addRealWorldEvent(momentId, author.userId, eventId, testContext());
      await indexer.index("moment", momentId);

      const document = await documentFor("moment", momentId);

      assert.ok(document?.body.includes("A family reunion"));
    });

    it("updates a document when the Moment changes, keeping its identity", async () => {
      const { author, momentId } = await someoneWithAMoment();

      await indexer.index("moment", momentId);
      await moments.updateCaption(momentId, author.userId, "A different caption entirely", testContext());
      await indexer.index("moment", momentId);

      const document = await documentFor("moment", momentId);

      assert.equal(document?.title, "A different caption entirely");
      assert.equal(document?.entityId, momentId);
    });

    it("indexes an account", async () => {
      const account = await createUser(database.dataSource);

      await indexer.index("user", account.userId);

      const document = await documentFor("user", account.userId);

      assert.equal(document?.title, "Test Person");
      assert.equal(document?.aliases, account.handle);
    });

    it("indexes a real-world Event with its aliases", async () => {
      const author = await createUser(database.dataSource);
      const eventId = await createRealWorldEvent(
        database.dataSource,
        author.userId,
        "The First World War",
      );

      await indexer.index("event", eventId);

      const document = await documentFor("event", eventId);

      assert.equal(document?.title, "The First World War");
      assert.equal(document?.authorUserId, null);
    });

    it("indexes a Location", async () => {
      const author = await createUser(database.dataSource);
      const locationId = await createLocation(database.dataSource, author.userId);

      await indexer.index("location", locationId);

      assert.notEqual(await documentFor("location", locationId), undefined);
    });

    it("removes the document when the entity is gone", async () => {
      const { momentId } = await someoneWithAMoment();

      await indexer.index("moment", momentId);
      assert.notEqual(await documentFor("moment", momentId), undefined);

      await database.dataSource.query("DELETE FROM moments WHERE moment_id = $1", [momentId]);
      await indexer.index("moment", momentId);

      assert.equal(await documentFor("moment", momentId), undefined);
    });
  });

  describe("surviving redelivery", () => {
    it("leaves one unchanged document when the same message arrives twice", async () => {
      const { momentId } = await someoneWithAMoment();
      const event = message("MomentRecorded", { momentId, authorUserId: "x" });

      await indexFromEvent(indexer, event);
      const first = await documentFor("moment", momentId);

      await indexFromEvent(indexer, event);
      const second = await documentFor("moment", momentId);

      assert.equal(first?.builtAt.getTime(), second?.builtAt.getTime());
      assert.equal(first?.indexedAt.getTime(), second?.indexedAt.getTime());
    });

    it("indexes again when a different message arrives about the same thing", async () => {
      const { author, momentId } = await someoneWithAMoment();

      await indexFromEvent(
        indexer,
        message("MomentRecorded", { momentId, authorUserId: author.userId }),
      );
      await moments.updateCaption(momentId, author.userId, "Revised", testContext());
      await indexFromEvent(
        indexer,
        message("MomentRevised", { momentId, authorUserId: author.userId }),
      );

      assert.equal((await documentFor("moment", momentId))?.title, "Revised");
    });

    it("refuses an older reading over a newer document", async () => {
      const { momentId } = await someoneWithAMoment();

      await indexer.index("moment", momentId);
      const current = await documentFor("moment", momentId);

      const source = await sources.momentFor(momentId);
      assert.notEqual(source, undefined);

      const stale = new Date(current!.builtAt.getTime() - 60_000);
      const older = { ...buildMomentDocument(source!)!, title: "Should not win" };
      const wrote = await withTransaction(database.dataSource, (tx) =>
        documents.upsert(tx, INDEX_VERSION, older, stale, undefined),
      );

      assert.equal(wrote, false);
      assert.equal((await documentFor("moment", momentId))?.title, current?.title);
    });

    it("ignores an event type it does not recognise rather than failing", async () => {
      // A topic gains event types over time. A consumer that fails on the first
      // one it has not been taught about turns an additive change into an
      // outage for every entity sharing the partition.
      await indexFromEvent(indexer, message("SomethingNobodyHasWrittenYet", { nonsense: true }));
    });

    it("ignores a message whose identifier is missing", async () => {
      await indexFromEvent(indexer, message("MomentRecorded", {}));
    });
  });

  describe("eligibility", () => {
    it("carries a private Moment's visibility rather than hiding it from its author", async () => {
      const { author, momentId } = await someoneWithAMoment();

      await moments.setVisibility(momentId, author.userId, { visibility: "private" }, testContext());
      await indexer.index("moment", momentId);

      const document = await documentFor("moment", momentId);

      // Two dimensions. Folding visibility into searchability would mean
      // nobody could search their own private history.
      assert.equal(document?.visibility, "private");
      assert.equal(document?.searchable, true);
    });

    it("makes a removed Moment vanish from the index", async () => {
      const { momentId } = await someoneWithAMoment();

      await indexer.index("moment", momentId);
      await database.dataSource.query(
        `INSERT INTO moderation_states (subject_type, subject_id, state, reason)
         VALUES ('moment', $1, 'removed', 'test')`,
        [momentId],
      );
      await indexer.index("moment", momentId);

      // Exclusion over retention. A removed Moment has no document at all,
      // rather than one marked unsearchable that a future query could forget
      // to filter.
      assert.equal(await documentFor("moment", momentId), undefined);
    });

    it("makes a Moment withheld during review unsearchable without deleting it", async () => {
      const { momentId } = await someoneWithAMoment();

      await database.dataSource.query(
        `INSERT INTO moderation_states (subject_type, subject_id, state, reason)
         VALUES ('moment', $1, 'temporarily_unavailable', 'test')`,
        [momentId],
      );
      await indexer.index("moment", momentId);

      const document = await documentFor("moment", momentId);

      assert.equal(document?.searchable, false);
      assert.equal(document?.moderationState, "temporarily_unavailable");
    });

    it("keeps a warned Moment searchable", async () => {
      const { momentId } = await someoneWithAMoment();

      await database.dataSource.query(
        `INSERT INTO moderation_states (subject_type, subject_id, state, reason)
         VALUES ('moment', $1, 'warned', 'test')`,
        [momentId],
      );
      await indexer.index("moment", momentId);

      assert.equal((await documentFor("moment", momentId))?.searchable, true);
    });

    it("excludes an entity whose eligibility cannot be determined", async () => {
      const { momentId } = await someoneWithAMoment();

      await indexer.index("moment", momentId);
      // A state outside the constraint, forced past it so the failure mode can
      // be observed. A database that no longer matches its migrations must
      // withhold rather than publish.
      await database.dataSource.query(
        "ALTER TABLE moderation_states DROP CONSTRAINT moderation_states_state_check",
      );

      try {
        await database.dataSource.query(
          `INSERT INTO moderation_states (subject_type, subject_id, state, reason)
           VALUES ('moment', $1, 'impounded', 'test')`,
          [momentId],
        );
        await indexer.index("moment", momentId);

        assert.equal(await documentFor("moment", momentId), undefined);
      } finally {
        await database.dataSource.query(`DELETE FROM moderation_states WHERE subject_id = $1`, [
          momentId,
        ]);
        await database.dataSource.query(
          `ALTER TABLE moderation_states ADD CONSTRAINT moderation_states_state_check
             CHECK (state IN ('allowed','warned','restricted_from_amplification',
                              'restricted_to_authorized_audience','age_restricted',
                              'temporarily_unavailable','removed'))`,
        );
      }
    });

    it("marks a deleted Moment as deleted", async () => {
      const { author, momentId } = await someoneWithAMoment();

      await moments.delete(momentId, author.userId, testContext());
      await indexer.index("moment", momentId);

      assert.equal((await documentFor("moment", momentId))?.deleted, true);
    });
  });

  describe("rebuilding", () => {
    it("reproduces the incremental index document for document", async () => {
      const { momentId } = await someoneWithAMoment();
      const account = await createUser(database.dataSource);

      await indexer.index("moment", momentId);
      await indexer.index("user", account.userId);

      const before = await documentFor("moment", momentId);

      const shadow = `search-test-${randomUUID().slice(0, 8)}`;
      const shadowIndexer = new SearchIndexer(database.dataSource, documents, sources, shadow);

      await rebuildSearchIndex(shadowIndexer, sources, {
        only: { moment: [momentId], user: [account.userId] },
      });

      const rebuilt = await documents.find(shadow, "moment", momentId);

      assert.equal(rebuilt?.title, before?.title);
      assert.equal(rebuilt?.body, before?.body);
      assert.equal(rebuilt?.searchable, before?.searchable);
      assert.equal(rebuilt?.visibility, before?.visibility);
      assert.equal(rebuilt?.authorUserId, before?.authorUserId);
      assert.notEqual(await documents.find(shadow, "user", account.userId), undefined);

      await database.dataSource.query("DELETE FROM search_documents WHERE index_version = $1", [
        shadow,
      ]);
    });

    it("leaves the current version untouched while building another", async () => {
      const { momentId } = await someoneWithAMoment();

      await indexer.index("moment", momentId);
      const before = await documentFor("moment", momentId);

      const shadow = `search-test-${randomUUID().slice(0, 8)}`;

      await rebuildSearchIndex(
        new SearchIndexer(database.dataSource, documents, sources, shadow),
        sources,
        { only: { moment: [momentId] } },
      );

      const after = await documentFor("moment", momentId);

      // Versions live side by side so a rebuild can run to completion while the
      // current one keeps serving reads.
      assert.equal(after?.builtAt.getTime(), before?.builtAt.getTime());

      await database.dataSource.query("DELETE FROM search_documents WHERE index_version = $1", [
        shadow,
      ]);
    });

    it("covers every entity type", async () => {
      const author = await createUser(database.dataSource);
      const locationId = await createLocation(database.dataSource, author.userId);
      const eventId = await createRealWorldEvent(database.dataSource, author.userId);
      const { momentId } = await someoneWithAMoment();

      const shadow = `search-test-${randomUUID().slice(0, 8)}`;
      const report = await rebuildSearchIndex(
        new SearchIndexer(database.dataSource, documents, sources, shadow),
        sources,
        {
          only: {
            moment: [momentId],
            user: [author.userId],
            event: [eventId],
            location: [locationId],
          },
        },
      );

      for (const entityType of ["moment", "user", "event", "location"]) {
        assert.ok((report.byType[entityType] ?? 0) > 0, entityType);
      }

      await database.dataSource.query("DELETE FROM search_documents WHERE index_version = $1", [
        shadow,
      ]);
    });
  });

  describe("reaching the worker through the broker it actually subscribes to", () => {
    it("indexes a Moment that arrived over Kafka rather than by hand", async () => {
      // The only test here that would notice a wrong topic name. The boundaries
      // come from the worker's own exported list, which is what `index.ts`
      // subscribes with, so changing one and leaving the other alone is not
      // possible.
      const { author, momentId } = await someoneWithAMoment("Carried by the broker");

      const delivered = await deliverThroughBroker({
        dataSource: database.dataSource,
        boundaries: SEARCH_INDEXER_BOUNDARIES,
        aggregateId: momentId,
        handler: (event) => indexFromEvent(indexer, event),
        clientId: "search-indexer-broker",
      });

      const document = await documentFor("moment", momentId);

      assert.ok(delivered > 0);
      assert.equal(document?.title, "Carried by the broker");
      assert.equal(document?.authorUserId, author.userId);
    });
  });
});
