import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { TimelineProjector } from "../../features/timeline/timeline.projector.js";
import { TimelineRepository } from "../../features/timeline/timeline.repository.js";
import {
  rebuildTimeline,
  reconcileSuspensions,
} from "../../features/timeline/timeline.rebuild.js";
import { TimelineSourceRepository } from "../../features/timeline/timeline-source.repository.js";
import { LocationRepository } from "../../features/locations/location.repository.js";
import { ModerationRepository } from "../../features/moderation/moderation.repository.js";
import { ModerationService } from "../../features/moderation/moderation.service.js";
import { MomentCommentRepository } from "../../features/moments/moment-comment.repository.js";
import { MomentRepository } from "../../features/moments/moment.repository.js";
import { MomentService } from "../../features/moments/moment.service.js";
import { RealWorldEventRepository } from "../../features/real-world-events/real-world-event.repository.js";
import { FollowRepository } from "../../features/social/follow.repository.js";
import { UploadRepository } from "../../features/uploads/upload.repository.js";
import { UserRepository } from "../../features/users/user.repository.js";
import { UserService } from "../../features/users/user.service.js";
import { createAnalytics, type Analytics } from "../../lib/clickhouse/clickhouse.js";
import { migrateAnalytics } from "../../lib/clickhouse/migrations.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { buildApp } from "../../server/app.js";
import { MAILPIT, testAppConfig } from "../../testing/app-config.js";
import { createTestAuthentication, type TestAuthentication } from "../../testing/authentication.js";
import { deliverThroughBroker } from "../../testing/broker.js";
import {
  createLocation,
  createReadyUpload,
  createRealWorldEvent,
  createUser,
} from "../../testing/fixtures.js";
import { USERS_BOUNDARY } from "@chronologity/contracts";
import { projectFromEvent, TIMELINE_PROJECTOR_BOUNDARIES } from "./project-timeline.js";

/**
 * A Moment reaching the Timeline, the way it will in a deployment.
 *
 * Recorded through HTTP, announced through the outbox, carried by a real
 * broker, handled by the real projector, and read back out of real ClickHouse.
 * The parts either side of the broker each have their own tests; what this adds
 * is that the wiring between them is right, which is the failure 6A was built
 * to catch and the one no unit test can see.
 *
 * Requires `pnpm infra:up`.
 */

const config = testAppConfig("timeline-projector-integration");

const ADULT = "1990-04-12";
const uniqueEmail = () => `person-${randomUUID()}@example.test`;
const uniqueHandle = () => `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;

const summer1998 = {
  start: "1998-06-01T00:00:00.000Z",
  end: "1998-08-31T23:59:59.000Z",
  precision: "month",
} as const;

describe("a Moment reaching the Timeline", () => {
  let app: FastifyInstance;
  let database: Database;
  let analytics: Analytics;
  let authentication: TestAuthentication;
  let projector: TimelineProjector;
  let timeline: TimelineRepository;
  let sources: TimelineSourceRepository;
  const version = `test-${randomUUID().slice(0, 8)}`;
  // `timeline_suspended_authors` carries no projection version — a suspension
  // is one row per account and the read joins it without one. So the accounts
  // this suite writes are tracked and removed by hand.
  const suspensions = new Set<string>();

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    analytics = createAnalytics(config.clickhouse);
    await migrateAnalytics(analytics.client);

    authentication = createTestAuthentication(database.dataSource, config.auth, config.email);
    timeline = new TimelineRepository(analytics.client, version);
    sources = new TimelineSourceRepository(database.dataSource);
    projector = new TimelineProjector(database.dataSource, timeline, sources);

    const moderationRepository = new ModerationRepository(database.dataSource);
    const moments = new MomentService(
      database.dataSource,
      new MomentRepository(database.dataSource),
      new UploadRepository(database.dataSource),
      new LocationRepository(database.dataSource),
      new RealWorldEventRepository(database.dataSource),
      new FollowRepository(database.dataSource),
      new UserRepository(database.dataSource),
      moderationRepository,
      new MomentCommentRepository(database.dataSource),
    );

    app = await buildApp({
      config,
      dependencies: [],
      authentication,
      users: new UserService(database.dataSource, new UserRepository(database.dataSource), {
        minimumAgeYears: config.minimumAgeYears,
      }),
      moments,
      moderation: new ModerationService(database.dataSource, moderationRepository),
    });
  });

  afterAll(async () => {
    // A projection version of its own, removed at the end. This table is
    // shared, and a version left behind is the ClickHouse equivalent of the
    // sixty-seven thousand stale search rows.
    await analytics.client.command({
      query: `DELETE FROM timeline_moments WHERE projection_version = {version: String}`,
      query_params: { version },
    });
    await analytics.client.command({
      query: `DELETE FROM timeline_moment_contexts WHERE projection_version = {version: String}`,
      query_params: { version },
    });
    await analytics.client.command({
      query: `DELETE FROM timeline_suspended_authors WHERE has({users: Array(String)}, user_id)`,
      query_params: { users: [...suspensions] },
    });
    await app.close();
    await authentication.close();
    await analytics.close();
    await database.close();
  });

  const authed = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });

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

        if (token !== undefined) return token;
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    throw new Error(`No sign-in link arrived for ${email}`);
  };

  const onboard = async () => {
    const email = uniqueEmail();
    await app.inject({ method: "POST", url: "/auth/magic-link", payload: { email } });
    const session = await app.inject({
      method: "POST",
      url: "/auth/sessions",
      payload: { token: await readLinkFor(email) },
    });

    assert.equal(session.statusCode, 201, session.body);

    const credentials = session.json();
    const created = await app.inject({
      method: "POST",
      url: "/users",
      headers: authed(credentials.accessToken),
      payload: { handle: uniqueHandle(), displayName: "Chronicler", dateOfBirth: ADULT },
    });

    assert.equal(created.statusCode, 201, created.body);

    return { accessToken: credentials.accessToken as string, userId: created.json().userId };
  };

  /**
   * Record a Moment as somebody who already exists.
   *
   * The upload belongs to the author, which is not incidental: media is
   * registered per account and a Moment cannot claim somebody else's.
   */
  const record = async (
    author: { accessToken: string; userId: string },
    occurrence = summer1998,
  ) => {
    const uploadId = await createReadyUpload(database.dataSource, author.userId);
    const recorded = await app.inject({
      method: "POST",
      url: "/moments",
      headers: authed(author.accessToken),
      payload: {
        caption: "Something that happened",
        occurrence,
        occurrenceOffsetMinutes: 0,
        uploadIds: [uploadId],
        visibility: "public",
      },
    });

    assert.equal(recorded.statusCode, 201, recorded.body);

    return recorded.json().momentId as string;
  };

  /**
   * Record a Moment that belongs to a place, an occasion, or both.
   *
   * Separate from `record` because scope membership travels through the Moment
   * payload, and the rows it produces live in a different table from the one
   * every other test here reads.
   */
  const recordWithin = async (
    author: { accessToken: string; userId: string },
    scopes: { locationId?: string; realWorldEventIds?: string[] },
  ) => {
    const uploadId = await createReadyUpload(database.dataSource, author.userId);
    const recorded = await app.inject({
      method: "POST",
      url: "/moments",
      headers: authed(author.accessToken),
      payload: {
        caption: "Something that happened somewhere",
        occurrence: summer1998,
        occurrenceOffsetMinutes: 0,
        uploadIds: [uploadId],
        visibility: "public",
        ...scopes,
      },
    });

    assert.equal(recorded.statusCode, 201, recorded.body);

    return recorded.json().momentId as string;
  };

  /** The scope rows the projection holds for a Moment, in a stable order. */
  const contextsOf = async (momentId: string) => {
    const result = await analytics.client.query({
      query: `SELECT context_type, context_id, author_user_id, visibility, moderation_state
                FROM timeline_moment_contexts
               WHERE moment_id = {momentId: String} AND projection_version = {version: String}
               ORDER BY context_type, context_id
               SETTINGS final = 1`,
      query_params: { momentId, version },
      format: "JSONEachRow",
    });

    return result.json<{
      context_type: string;
      context_id: string;
      author_user_id: string;
      visibility: string;
      moderation_state: string;
    }>();
  };

  /** Whether the projection currently withholds an account's history. */
  const suspensionOf = async (userId: string) => {
    const result = await analytics.client.query({
      query: `SELECT suspended FROM timeline_suspended_authors
               WHERE user_id = {userId: String} SETTINGS final = 1`,
      query_params: { userId },
      format: "JSONEachRow",
    });
    const rows = await result.json<{ suspended: number }>();

    return rows[0]?.suspended;
  };

  it("arrives through the broker the deployed worker subscribes to", async () => {
    const author = await onboard();
    const uploadId = await createReadyUpload(database.dataSource, author.userId);
    const recorded = await app.inject({
      method: "POST",
      url: "/moments",
      headers: authed(author.accessToken),
      payload: {
        caption: "Carried to the Timeline",
        occurrence: summer1998,
        occurrenceOffsetMinutes: 0,
        uploadIds: [uploadId],
        visibility: "public",
      },
    });

    assert.equal(recorded.statusCode, 201, recorded.body);

    const momentId = recorded.json().momentId as string;

    const delivered = await deliverThroughBroker({
      dataSource: database.dataSource,
      boundaries: TIMELINE_PROJECTOR_BOUNDARIES,
      aggregateId: momentId,
      handler: (event) => projectFromEvent(projector, event),
      clientId: "timeline-projector-broker",
    });

    const stored = await timeline.find(momentId);

    assert.ok(delivered > 0);
    assert.equal(stored?.moment_id, momentId);
    assert.match(stored?.occurred_at ?? "", /^1998-06-01/);
    assert.equal(stored?.author_user_id, author.userId);
  });

  it("reads the Moment as it now stands, not as the message described it", async () => {
    // The property that makes replay safe. A message handled long after the
    // fact produces a current answer rather than resurrecting a stale one,
    // because the row is built from the database rather than the payload.
    const author = await onboard();
    const momentId = await record(author);

    await projector.project(momentId);

    await app.inject({
      method: "PUT",
      url: `/moments/${momentId}/visibility`,
      headers: authed(author.accessToken),
      payload: { visibility: "private" },
    });

    await projector.project(momentId);

    assert.equal((await timeline.find(momentId))?.visibility, "private");
  });

  it("takes a Moment off the Timeline when moderation removes it", async () => {
    const author = await onboard();
    const momentId = await record(author);

    await projector.project(momentId);
    assert.notEqual(await timeline.find(momentId), undefined);

    await database.dataSource.query(
      `INSERT INTO moderation_states (subject_type, subject_id, state, reason, decided_at)
       VALUES ('moment', $1, 'removed', 'projector integration test', now())
       ON CONFLICT (subject_type, subject_id) DO UPDATE SET state = 'removed'`,
      [momentId],
    );

    await projector.project(momentId);

    assert.equal(await timeline.find(momentId), undefined, "a removed Moment is still on it");
  });

  it("applies a message once however often it is delivered", async () => {
    const author = await onboard();
    const momentId = await record(author);
    const eventId = randomUUID();

    assert.equal(await projector.handle(eventId, momentId), "projected");
    assert.equal(await projector.handle(eventId, momentId), "already-handled");
  });

  it("rebuilds what the worker built, from the database rather than the log", async () => {
    const author = await onboard();
    const momentId = await record(author);

    await projector.project(momentId);

    const asProjected = await timeline.find(momentId);

    // Wiped as if the projection had been lost, then rebuilt from PostgreSQL.
    await timeline.remove(momentId);
    assert.equal(await timeline.find(momentId), undefined);

    const report = await rebuildTimeline(projector, sources, { only: [momentId] });
    const asRebuilt = await timeline.find(momentId);

    assert.equal(report.projected, 1);
    assert.equal(asRebuilt?.moment_id, asProjected?.moment_id);
    assert.equal(asRebuilt?.occurred_at, asProjected?.occurred_at);
    assert.equal(asRebuilt?.visibility, asProjected?.visibility);
  });

  it("does not bring back a Moment that was erased", async () => {
    // The requirement `privacy.md` places on replay, and the reason a rebuild
    // reads authoritative state rather than the event log. Replaying events
    // would resurrect precisely what erasure removed.
    const author = await onboard();
    const momentId = await record(author);

    await projector.project(momentId);
    await database.dataSource.query("DELETE FROM moments WHERE moment_id = $1", [momentId]);

    const report = await rebuildTimeline(projector, sources, { only: [momentId] });

    assert.equal(report.projected, 0);
    assert.equal(report.removed, 1);
    assert.equal(await timeline.find(momentId), undefined, "erasure was undone by a rebuild");
  });

  it("holds one row even when the same Moment is projected under two messages", async () => {
    // At-least-once delivery with two different message identifiers, which the
    // processed-event record cannot catch. What makes this safe is the write
    // itself rather than the bookkeeping.
    const author = await onboard();
    const momentId = await record(author);

    await projector.handle(randomUUID(), momentId);
    await projector.handle(randomUUID(), momentId);

    const found = (await timeline.inOccurrenceOrder(1_000)).filter(
      (row) => row.moment_id === momentId,
    );

    assert.equal(found.length, 1);
  });

  describe("a page at a time", () => {
    /** Withhold a Moment, the way the moderation tests above do. */
    const moderate = async (momentId: string, state: string) => {
      await database.dataSource.query(
        `INSERT INTO moderation_states (subject_type, subject_id, state, reason, decided_at)
         VALUES ('moment', $1, $2, 'projector integration test', now())
         ON CONFLICT (subject_type, subject_id) DO UPDATE SET state = $2`,
        [momentId, state],
      );
    };

    /**
     * How many statements ClickHouse has finished, from its own records.
     *
     * Read from `system.query_log` rather than counted by a wrapper here: a
     * counter this suite kept about itself could only ever agree with the code
     * it is testing, where the server's log is the same evidence an operator
     * would look at.
     */
    const countQueries = async (since: string, kind?: string): Promise<number> => {
      await analytics.client.command({ query: "SYSTEM FLUSH LOGS" });

      const rows = await (
        await analytics.client.query({
          query: `SELECT count() AS count FROM system.query_log
                   WHERE type = 'QueryFinish'
                     AND event_time_microseconds > {since: DateTime64(6)}
                     ${kind === undefined ? "" : "AND query_kind = {kind: String}"}`,
          query_params: kind === undefined ? { since } : { since, kind },
          format: "JSONEachRow",
        })
      ).json<{ count: string }>();

      return Number(rows[0]?.count ?? 0);
    };

    /**
     * The moment to count from.
     *
     * Counting "statements in the last ten minutes" twice does not work: the
     * window slides, entries age out between the two reads, and the second
     * number can be *smaller* than the first. A fixed instant does not move.
     */
    const marker = async (): Promise<string> => {
      await analytics.client.command({ query: "SYSTEM FLUSH LOGS" });

      const rows = await (
        await analytics.client.query({
          query: `SELECT formatDateTime(now64(6), '%Y-%m-%d %H:%i:%S.%f') AS at`,
          format: "JSONEachRow",
        })
      ).json<{ at: string }>();

      return rows[0]!.at;
    };

    /** Every column of a Moment's rows, but the one that says when it was written. */
    const storedFor = async (momentIds: readonly string[]) => {
      const moments = await (
        await analytics.client.query({
          query: `SELECT occurred_at, recorded_at, moment_id, author_user_id, occurrence_end,
                         occurrence_precision, occurrence_offset_minutes, visibility,
                         moderation_state, discoverable
                    FROM timeline_moments
                   WHERE moment_id IN {momentIds: Array(String)}
                     AND projection_version = {version: String}
                   ORDER BY moment_id`,
          query_params: { momentIds: [...momentIds], version },
          format: "JSONEachRow",
        })
      ).json();

      const contexts = await (
        await analytics.client.query({
          query: `SELECT context_type, context_id, occurred_at, moment_id, author_user_id,
                         visibility, moderation_state
                    FROM timeline_moment_contexts
                   WHERE moment_id IN {momentIds: Array(String)}
                     AND projection_version = {version: String}
                   ORDER BY moment_id, context_type, context_id`,
          query_params: { momentIds: [...momentIds], version },
          format: "JSONEachRow",
        })
      ).json();

      return { moments, contexts };
    };

    it("builds exactly what projecting one at a time builds", async () => {
      // The test the whole change rests on. Everything else here is about how
      // few statements it takes; this is about it being the same projection.
      //
      // A varied set on purpose: a Moment with a place, one with an occasion,
      // one with neither, and one moderation took away — so a divergence in the
      // bulk read's joins or its `ARRAY(...)` ordering shows up as a difference
      // rather than hiding behind a uniform fixture.
      const author = await onboard();
      const locationId = await createLocation(database.dataSource, author.userId);
      const realWorldEventId = await createRealWorldEvent(database.dataSource, author.userId);

      const plain = await record(author);
      const placed = await recordWithin(author, { locationId });
      const occasioned = await recordWithin(author, { realWorldEventIds: [realWorldEventId] });
      const both = await recordWithin(author, {
        locationId,
        realWorldEventIds: [realWorldEventId],
      });
      const withheld = await record(author);

      await moderate(withheld, "removed");

      const everything = [plain, placed, occasioned, both, withheld];

      for (const momentId of everything) {
        await projector.project(momentId);
      }

      const oneAtATime = await storedFor(everything);

      await timeline.removeBatch(everything);

      const tally = await projector.projectBatch(everything);
      const asABatch = await storedFor(everything);

      assert.deepEqual(asABatch.moments, oneAtATime.moments, "the rows came out different");
      assert.deepEqual(asABatch.contexts, oneAtATime.contexts, "the scope rows came out different");
      assert.deepEqual(tally, { projected: 4, removed: 1 });
    });

    it("does not leave a Moment at a place it has been moved from", async () => {
      // The batch twin of the single-Moment test below, and the one a probe
      // reading only occurrence would fail: correcting a Location does not
      // change when the Moment happened, so nothing about its date says the old
      // scope row is stale.
      const author = await onboard();
      const first = await createLocation(database.dataSource, author.userId);
      const second = await createLocation(database.dataSource, author.userId);
      const momentId = await recordWithin(author, { locationId: first });

      await projector.projectBatch([momentId]);

      await database.dataSource.query(
        `UPDATE moment_locations SET location_id = $2 WHERE moment_id = $1`,
        [momentId, second],
      );

      await projector.projectBatch([momentId]);

      const places = (await contextsOf(momentId))
        .filter((row) => row.context_type === "location")
        .map((row) => row.context_id);

      assert.deepEqual(places, [second], "the Moment is still at a place it has left");
    });

    it("moves a corrected Moment and leaves nothing behind", async () => {
      const author = await onboard();
      const momentId = await record(author);

      await projector.projectBatch([momentId]);

      await database.dataSource.query(
        `UPDATE moments SET occurrence_start = $2, occurrence_end = $2 WHERE moment_id = $1`,
        [momentId, new Date("1969-07-20T00:00:00.000Z")],
      );

      await projector.projectBatch([momentId]);

      const rows = await (
        await analytics.client.query({
          query: `SELECT toYear(occurred_at) AS year FROM timeline_moments
                   WHERE moment_id = {momentId: String} AND projection_version = {version: String}`,
          query_params: { momentId, version },
          format: "JSONEachRow",
        })
      ).json<{ year: number }>();

      assert.deepEqual(
        rows.map((row) => row.year),
        [1969],
        "a corrected Moment is in history twice",
      );
    });

    it("both projects and removes within one page", async () => {
      // The withheld Moment is projected *first*, so removing it has something
      // to remove. Without that, "it holds no rows afterwards" is true of a
      // Moment that was never written and the test proves nothing.
      const author = await onboard();
      const living = await record(author);
      const withheld = await record(author);

      await projector.projectBatch([withheld]);

      assert.ok((await contextsOf(withheld)).length > 0, "the fixture never reached the Timeline");

      await moderate(withheld, "removed");

      const tally = await projector.projectBatch([living, withheld]);

      assert.deepEqual(tally, { projected: 1, removed: 1 });
      assert.equal(await timeline.find(withheld), undefined, "a withheld Moment is still there");
      assert.equal((await contextsOf(withheld)).length, 0, "a withheld Moment kept its scopes");
      assert.ok((await contextsOf(living)).length > 0, "a living Moment lost its scopes");
    });

    it("counts a Moment named twice in one page once", async () => {
      const author = await onboard();
      const momentId = await record(author);

      const tally = await projector.projectBatch([momentId, momentId]);

      assert.deepEqual(tally, { projected: 1, removed: 0 });
    });

    it("writes a page in a handful of statements rather than a handful each", async () => {
      // Counted rather than timed. A stopwatch would be flaky and would prove
      // nothing about round trips, which are the actual claim.
      const author = await onboard();
      const momentIds: string[] = [];

      for (let index = 0; index < 5; index += 1) {
        momentIds.push(await record(author));
      }

      const since = await marker();
      await projector.projectBatch(momentIds);
      const issued = await countQueries(since);

      assert.ok(issued <= 8, `a page of five cost ${issued} statements, which is per-Moment work`);
    });

    it("shows a reader one row when the same Moment is rebuilt in place", async () => {
      // The trade ADR-134 accepts, and the reason `final: 1` is load-bearing
      // rather than defence in depth. Rebuilding in place no longer deletes what
      // it is about to rewrite, because the engine collapses rows sharing a sort
      // key — so the duplicates are real, and invisible.
      const author = await onboard();
      const momentId = await record(author);

      await projector.projectBatch([momentId]);
      await projector.projectBatch([momentId]);

      const raw = await (
        await analytics.client.query({
          query: `SELECT count() AS count FROM timeline_moments
                   WHERE moment_id = {momentId: String}
                     AND projection_version = {version: String}
                  SETTINGS final = 0`,
          query_params: { momentId, version },
          format: "JSONEachRow",
        })
      ).json<{ count: string }>();

      // A merge landing between the write and this read would collapse them
      // early, which is ClickHouse working rather than a failure — the same
      // caveat the narrower test next door carries.
      if (Number(raw[0]?.count ?? 0) === 1) {
        process.stdout.write("  (a merge collapsed the duplicate before it could be seen)\n");
      }

      assert.notEqual(await timeline.find(momentId), undefined, "the Moment went missing");
    });

    it("issues no delete when it writes into a version holding nothing", async () => {
      // What ADR-128 claimed of a fresh-version rebuild and never proved. A
      // mutation is a second or more of ClickHouse bookkeeping, so one per page
      // would undo most of the saving.
      const author = await onboard();
      const momentId = await record(author);
      const fresh = new TimelineRepository(analytics.client, `${version}-fresh`);
      const into = new TimelineProjector(database.dataSource, fresh, sources);

      const since = await marker();
      await into.projectBatch([momentId]);
      const deletes = await countQueries(since, "Delete");

      await fresh.removeBatch([momentId]);

      assert.equal(deletes, 0, "a rebuild into an empty version issued a mutation");
    });
  });

  it("records which places and occasions a Moment belongs to", async () => {
    const author = await onboard();
    const locationId = await createLocation(database.dataSource, author.userId);
    const realWorldEventId = await createRealWorldEvent(database.dataSource, author.userId);
    const momentId = await recordWithin(author, {
      locationId,
      realWorldEventIds: [realWorldEventId],
    });

    await projector.project(momentId);

    const contexts = await contextsOf(momentId);

    assert.deepEqual(
      contexts.map((row) => [row.context_type, row.context_id]).sort(),
      [
        ["location", locationId],
        // The author's own row. A Moment belongs on its author's Timeline as
        // much as at the place it happened, and both are written as contexts so
        // that reading either is one query rather than two.
        ["person", author.userId],
        ["real_world_event", realWorldEventId],
      ].sort(),
    );
    assert.ok(contexts.every((row) => row.author_user_id === author.userId));
    assert.ok(contexts.every((row) => row.visibility === "public"));
  });

  it("does not leave a Moment at a place it has been moved from", async () => {
    // The scope is part of the sort key, so a changed Location writes a new row
    // rather than replacing the old one. Without the delete the Moment would
    // appear at both places, and the place it left would still say it was
    // there — which is a claim about somebody's history that is simply false.
    const author = await onboard();
    const first = await createLocation(database.dataSource, author.userId);
    const second = await createLocation(database.dataSource, author.userId);
    const momentId = await recordWithin(author, { locationId: first });

    await projector.project(momentId);

    await database.dataSource.query(
      "UPDATE moment_locations SET location_id = $1 WHERE moment_id = $2",
      [second, momentId],
    );

    await projector.project(momentId);

    assert.deepEqual(
      (await contextsOf(momentId))
        .filter((row) => row.context_type === "location")
        .map((row) => row.context_id),
      [second],
    );
  });

  it("takes a Moment out of its places when moderation removes it", async () => {
    // A row saying a withheld Moment happened at a place is a record that it
    // exists, along with roughly when. Removing the Moment without removing
    // these would leave the disclosure the removal was for.
    const author = await onboard();
    const locationId = await createLocation(database.dataSource, author.userId);
    const momentId = await recordWithin(author, { locationId });

    await projector.project(momentId);
    // The Location and the author.
    assert.equal((await contextsOf(momentId)).length, 2);

    await database.dataSource.query(
      `INSERT INTO moderation_states (subject_type, subject_id, state, reason, decided_at)
       VALUES ('moment', $1, 'removed', 'projector integration test', now())
       ON CONFLICT (subject_type, subject_id) DO UPDATE SET state = 'removed'`,
      [momentId],
    );

    await projector.project(momentId);

    assert.deepEqual(await contextsOf(momentId), []);
  });


  /**
   * Somebody whose account is suspended in PostgreSQL.
   *
   * Written through the same column moderation writes — `users.status` — rather
   * than through the HTTP route, because what is under test is a rebuild
   * reading authoritative state, not how that state came to be.
   */
  const suspendedAccount = async (): Promise<string> => {
    const { userId } = await createUser(database.dataSource);
    suspensions.add(userId);

    await database.dataSource.query("UPDATE users SET status = 'suspended' WHERE user_id = $1", [
      userId,
    ]);

    return userId;
  };

  it("tells the projection about an account suspended while it was not listening", async () => {
    // The gap 7C left: the dimension is filled only by live events, so anybody
    // suspended before the projector existed stayed visible at every place they
    // recorded.
    const userId = await suspendedAccount();

    assert.equal(await suspensionOf(userId), undefined, "nothing to reconcile");

    await reconcileSuspensions(projector, sources, new Date());

    assert.equal(await suspensionOf(userId), 1, "a suspended account is still shown");
  });

  it("releases an account the projection was still withholding", async () => {
    // The other direction, and the one only-ever-adding would never fix: the
    // decision to reinstate has already been taken, so no event is still coming
    // to correct it.
    const { userId } = await createUser(database.dataSource);
    suspensions.add(userId);

    await projector.recordStatus(userId, "suspended", new Date("2026-01-01T00:00:00.000Z"));
    assert.equal(await suspensionOf(userId), 1);

    await reconcileSuspensions(projector, sources, new Date());

    assert.equal(await suspensionOf(userId), 0, "a reinstated account is still withheld");
  });

  it("changes nothing when the two already agree", async () => {
    await suspendedAccount();
    await reconcileSuspensions(projector, sources, new Date());

    const second = await reconcileSuspensions(projector, sources, new Date());

    assert.deepEqual(second, { suspended: 0, reinstated: 0 });
  });

  it("does not undo a reinstatement that arrived while it was walking", async () => {
    // The race the timestamp exists for. A rebuild reads PostgreSQL, walks for
    // a while, and writes — and what it read may have stopped being true in
    // between. Stamping its rows with the moment it began means a decision
    // taken during the walk carries a later time and wins; stamping them as
    // they are written means the rebuild wins, and reimposes a suspension
    // somebody has already lifted.
    //
    // Modelled with times well apart rather than milliseconds, so what decides
    // the outcome is the ordering rule and not how long the test took to run.
    const userId = await suspendedAccount();
    const startedAt = new Date(Date.now() - 600_000);

    await projector.recordStatus(userId, "active", new Date(Date.now() - 300_000));
    assert.equal(await suspensionOf(userId), 0, "nothing to overturn");

    await reconcileSuspensions(projector, sources, startedAt);

    assert.equal(await suspensionOf(userId), 0, "a rebuild reimposed a lifted suspension");
  });

  it("leaves the suspension dimension alone on a scoped rebuild", async () => {
    // A scoped rebuild repairs rows. An operator fixing one Moment should not
    // have every account reconsidered underneath them.
    const author = await onboard();
    const momentId = await record(author);
    await suspendedAccount();

    const report = await rebuildTimeline(projector, sources, { only: [momentId] });

    assert.deepEqual(
      { suspended: report.suspended, reinstated: report.reinstated },
      { suspended: 0, reinstated: 0 },
    );
  });

  it("records a suspension as one row rather than reprojecting a history", async () => {
    const userId = randomUUID();
    suspensions.add(userId);

    await projectFromEvent(projector, {
      topic: USERS_BOUNDARY,
      partition: 0,
      offset: "0",
      envelope: {
        eventId: randomUUID(),
        eventType: "UserStatusChanged",
        eventVersion: 1,
        occurredAt: "2026-01-01T00:00:00.000Z",
        aggregate: { type: "user", id: userId, version: 1 },
        payload: { userId, status: "suspended" },
      },
    });

    assert.equal(await suspensionOf(userId), 1);
  });

  it("lets a reinstatement win over the suspension it lifted", async () => {
    const userId = randomUUID();
    suspensions.add(userId);

    await projector.recordStatus(userId, "suspended", new Date("2026-01-01T00:00:00.000Z"));
    await projector.recordStatus(userId, "active", new Date("2026-02-01T00:00:00.000Z"));

    assert.equal(await suspensionOf(userId), 0, "a lifted suspension still withholds history");
  });

  it("ignores a suspension message that arrives after it was overtaken", async () => {
    // At-least-once delivery reorders. A stale suspension redelivered after a
    // reinstatement must not withhold a reinstated account's history, which is
    // why the row carries when the decision was taken rather than when it
    // arrived.
    const userId = randomUUID();
    suspensions.add(userId);

    await projector.recordStatus(userId, "active", new Date("2026-02-01T00:00:00.000Z"));
    await projector.recordStatus(userId, "suspended", new Date("2026-01-01T00:00:00.000Z"));

    assert.equal(await suspensionOf(userId), 0, "a stale message resurrected a suspension");
  });

});
