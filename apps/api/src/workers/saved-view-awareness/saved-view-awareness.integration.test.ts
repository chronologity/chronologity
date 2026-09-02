import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { ViewSpecification } from "@chronologity/contracts";
import { createAnalytics, type Analytics } from "../../lib/clickhouse/clickhouse.js";
import { migrateAnalytics } from "../../lib/clickhouse/migrations.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { testAppConfig } from "../../testing/app-config.js";
import { createUser } from "../../testing/fixtures.js";
import { IdentityRepository } from "../../features/authentication/identity.repository.js";
import { LocationRepository } from "../../features/locations/location.repository.js";
import { ModerationRepository } from "../../features/moderation/moderation.repository.js";
import { MomentCommentRepository } from "../../features/moments/moment-comment.repository.js";
import { MomentRepository } from "../../features/moments/moment.repository.js";
import { MomentService } from "../../features/moments/moment.service.js";
import { NotificationDeliveryRepository } from "../../features/notifications/notification.delivery.repository.js";
import { NotificationDeliveryService } from "../../features/notifications/notification.delivery.service.js";
import { NotificationGenerator } from "../../features/notifications/notification.generator.js";
import { StoredRecipientDirectory } from "../../features/notifications/notification.recipients.js";
import { NotificationRepository } from "../../features/notifications/notification.repository.js";
import { RealWorldEventRepository } from "../../features/real-world-events/real-world-event.repository.js";
import { SavedViewRepository } from "../../features/saved-views/saved-view.repository.js";
import { FollowRepository } from "../../features/social/follow.repository.js";
import { UploadRepository } from "../../features/uploads/upload.repository.js";
import { UserRepository } from "../../features/users/user.repository.js";
import { TimelineEligibilityResolver } from "../../features/timeline/timeline.eligibility.js";
import { TimelineReadRepository } from "../../features/timeline/timeline.read.repository.js";
import { TimelineRepository } from "../../features/timeline/timeline.repository.js";
import { TimelineService } from "../../features/timeline/timeline.service.js";
import type { TimelineRow } from "../../features/timeline/timeline-row.js";
import { COUNT_CEILING, recountAwareness, recountOne } from "./recount-awareness.js";

/**
 * The sweep that keeps a badge honest.
 *
 * Two properties matter more than the arithmetic. A count must never survive
 * somebody looking at the view — the sweep reads a mark, spends time in
 * ClickHouse and writes back, and a visit landing in that gap has already
 * asserted zero. And a view onto a Timeline that has since closed must count
 * nothing, because deriving it would return nothing.
 *
 * No Fastify here. The suite next door drives the surface; this drives the
 * sweep, and inserts what it needs directly.
 *
 * Requires `pnpm infra:up`.
 */

const config = testAppConfig("saved-view-awareness-integration");
const version = `sweep-${randomUUID().slice(0, 8)}`;

describe("recounting what saved views have gained", () => {
  let database: Database;
  let analytics: Analytics;
  let projector: TimelineRepository;
  let savedViews: SavedViewRepository;
  let timeline: TimelineService;
  let notify: NotificationGenerator;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    analytics = createAnalytics(config.clickhouse);
    await migrateAnalytics(analytics.client);
    projector = new TimelineRepository(analytics.client, version);
    savedViews = new SavedViewRepository(database.dataSource);
    timeline = new TimelineService(
      new TimelineReadRepository(analytics.client, version),
      new TimelineEligibilityResolver(database.dataSource),
    );

    // The real generator, against the real tables. Substituting it would leave
    // the two properties worth proving — that one window says one thing, and
    // that a new window says something new — resting on a stand-in that agrees
    // with whatever the sweep does.
    const accounts = new UserRepository(database.dataSource);
    const notifications = new NotificationRepository(database.dataSource);

    notify = new NotificationGenerator(
      database.dataSource,
      notifications,
      new MomentService(
        database.dataSource,
        new MomentRepository(database.dataSource),
        new UploadRepository(database.dataSource),
        new LocationRepository(database.dataSource),
        new RealWorldEventRepository(database.dataSource),
        new FollowRepository(database.dataSource),
        accounts,
        new ModerationRepository(database.dataSource),
        new MomentCommentRepository(database.dataSource),
      ),
      new NotificationDeliveryService(
        database.dataSource,
        new NotificationDeliveryRepository(database.dataSource),
        notifications,
        accounts,
        new StoredRecipientDirectory(accounts, new IdentityRepository(database.dataSource)),
      ),
    );
  });

  afterAll(async () => {
    await analytics.client.command({
      query: `DELETE FROM timeline_moments WHERE projection_version = {version: String}`,
      query_params: { version },
    });
    await analytics.client.command({
      query: `DELETE FROM timeline_moment_contexts WHERE projection_version = {version: String}`,
      query_params: { version },
    });
    await analytics.close();
    await database.close();
  });

  /**
   * An account, made by the shared fixture rather than by hand.
   *
   * Nothing here drives HTTP: the surface has its own suite, and onboarding
   * through Mailpit for each of these would cost far more than the sweep does.
   */
  const anAccount = async (): Promise<string> => (await createUser(database.dataSource)).userId;

  const aView = async (
    userId: string,
    specification: ViewSpecification,
    over: { createdAt?: Date; lastVisitedAt?: Date; followed?: boolean } = {},
  ): Promise<string> => {
    const savedViewId = randomUUID();
    await database.dataSource.query(
      `INSERT INTO saved_views
         (saved_view_id, user_id, title, specification, created_at, updated_at,
          last_visited_at, followed)
       VALUES ($1, $2, 'A view', $3::jsonb, $4, $4, $5, $6)`,
      [
        savedViewId,
        userId,
        JSON.stringify(specification),
        over.createdAt ?? new Date("2020-01-01T00:00:00.000Z"),
        over.lastVisitedAt ?? null,
        over.followed ?? false,
      ],
    );
    await database.dataSource.query(
      `INSERT INTO saved_view_awareness (saved_view_id, visited_through) VALUES ($1, $2)`,
      [savedViewId, over.lastVisitedAt ?? null],
    );

    return savedViewId;
  };

  const place = async (authorUserId: string, occurred: string, recorded: Date, over: Partial<TimelineRow> = {}) => {
    const row: TimelineRow = {
      momentId: randomUUID(),
      authorUserId,
      occurredAt: new Date(occurred),
      recordedAt: recorded,
      occurrenceEnd: new Date(occurred),
      occurrencePrecision: "day",
      occurrenceOffsetMinutes: 0,
      visibility: "public",
      moderationState: "allowed",
      discoverable: true,
      ...over,
    };

    await projector.project(row);
    await projector.projectContexts(row, [{ type: "person", id: authorUserId }]);

    return row.momentId;
  };

  const ofPerson = (userId: string): ViewSpecification =>
    ({
      derivationVersion: 1,
      context: { type: "person", id: userId },
      perspective: "all",
      filters: {},
      position: {},
      limit: 50,
      direction: "older",
    }) as ViewSpecification;

  const storedFor = async (savedViewId: string) => {
    const rows: {
      new_moment_count: number;
      capped: boolean;
      visited_through: Date | null;
      computed_at: Date | null;
    }[] = await database.dataSource.query(
      `SELECT new_moment_count, capped, visited_through, computed_at
         FROM saved_view_awareness WHERE saved_view_id = $1`,
      [savedViewId],
    );

    return rows[0];
  };

  const stale = async (savedViewId: string) => {
    const due = await savedViews.stalest(500);
    const found = due.find((view) => view.savedViewId === savedViewId);

    assert.ok(found, "the view was not in the queue");

    return found;
  };

  it("writes what it counted", async () => {
    const person = await anAccount();
    const savedViewId = await aView(person, ofPerson(person));
    await place(person, "1969-07-20T00:00:00.000Z", new Date());

    const recorded = await recountOne(await stale(savedViewId), {
      dataSource: database.dataSource,
      savedViews,
      timeline,
    });

    assert.equal(recorded, true);

    const stored = await storedFor(savedViewId);

    assert.equal(stored?.new_moment_count, 1);
    assert.equal(stored?.capped, false);
    assert.ok(stored?.computed_at, "a count was written without saying when");
  });

  it("counts nothing for a Timeline that has since closed", async () => {
    const author = await anAccount();
    const reader = await anAccount();
    await place(author, "1969-07-20T00:00:00.000Z", new Date());
    await database.dataSource.query(
      `INSERT INTO user_preferences (user_id, timeline_is_public) VALUES ($1, false)
       ON CONFLICT (user_id) DO UPDATE SET timeline_is_public = false`,
      [author],
    );

    const savedViewId = await aView(reader, ofPerson(author));

    await recountOne(await stale(savedViewId), {
      dataSource: database.dataSource,
      savedViews,
      timeline,
    });

    assert.equal((await storedFor(savedViewId))?.new_moment_count, 0);
  });

  it("refuses to overwrite a visit that landed while it was counting", async () => {
    // The race the conditional write exists for. Overwriting would tell somebody
    // about history they had just been through.
    const person = await anAccount();
    const savedViewId = await aView(person, ofPerson(person));
    await place(person, "1969-07-20T00:00:00.000Z", new Date());

    const due = await stale(savedViewId);

    // Somebody looks, after the sweep read the mark and before it writes.
    const visitedAt = new Date();
    await database.dataSource.query(
      `UPDATE saved_views SET last_visited_at = $2 WHERE saved_view_id = $1`,
      [savedViewId, visitedAt],
    );
    await database.dataSource.query(
      `UPDATE saved_view_awareness
          SET new_moment_count = 0, visited_through = $2, computed_at = NULL
        WHERE saved_view_id = $1`,
      [savedViewId, visitedAt],
    );

    const recorded = await recountOne(due, {
      dataSource: database.dataSource,
      savedViews,
      timeline,
    });

    const stored = await storedFor(savedViewId);

    assert.equal(recorded, false, "the sweep overwrote a fresher visit");
    assert.equal(stored?.new_moment_count, 0, "a stale count replaced somebody's zero");
    assert.equal(stored?.computed_at, null, "the view left the queue without being recounted");
  });

  it("stops at the ceiling and says so", async () => {
    const person = await anAccount();
    const savedViewId = await aView(person, ofPerson(person));
    const recorded = new Date();

    for (let index = 0; index <= COUNT_CEILING; index += 1) {
      await place(person, `19${(index % 90) + 10}-01-0${(index % 9) + 1}T00:00:00.000Z`, recorded);
    }

    await recountOne(await stale(savedViewId), {
      dataSource: database.dataSource,
      savedViews,
      timeline,
    });

    const stored = await storedFor(savedViewId);

    assert.equal(stored?.new_moment_count, COUNT_CEILING);
    assert.equal(stored?.capped, true, "a count that hit the ceiling was presented as exact");
  });

  it("takes the stalest first, and a view just visited before all", async () => {
    const person = await anAccount();
    const older = await aView(person, ofPerson(person));
    const newer = await aView(person, ofPerson(person));

    await database.dataSource.query(
      `UPDATE saved_view_awareness SET computed_at = now() - interval '1 hour' WHERE saved_view_id = $1`,
      [older],
    );
    await database.dataSource.query(
      `UPDATE saved_view_awareness SET computed_at = now() WHERE saved_view_id = $1`,
      [newer],
    );

    const uncounted = await aView(person, ofPerson(person));
    // Not a sweep of an empty database: this one carries whatever every other
    // suite left behind, so the claim is about relative order among these three
    // rather than about which view is first overall.
    const queue = (await savedViews.stalest(5_000)).map((view) => view.savedViewId);

    assert.ok(
      queue.indexOf(older) < queue.indexOf(newer),
      "a fresher count was queued before a staler one",
    );
    assert.ok(
      queue.indexOf(uncounted) < queue.indexOf(older),
      "a view nothing has counted was queued after one that had been",
    );
  });

  it("bounds a pass by its batch, and says when there is nothing waiting", async () => {
    const person = await anAccount();
    await aView(person, ofPerson(person));
    await aView(person, ofPerson(person));

    const bounded = await recountAwareness({
      dataSource: database.dataSource,
      savedViews,
      timeline,
      batchSize: 1,
    });

    assert.equal(bounded.recounted + bounded.superseded, 1, "a pass exceeded its batch");
    assert.equal(bounded.reachedEnd, false, "a full batch reported nothing left to do");
  });

  describe("telling somebody a view they follow has grown", () => {
    const notificationsFor = async (userId: string) => {
      const rows: { type: string; source_id: string; read_at: Date | null }[] =
        await database.dataSource.query(
          `SELECT type, source_id, read_at FROM notifications
            WHERE recipient_user_id = $1 AND type = 'saved_view_expanded'`,
          [userId],
        );

      return rows;
    };

    const sweepOnce = async (savedViewId: string) =>
      recountOne(await stale(savedViewId), {
        dataSource: database.dataSource,
        savedViews,
        timeline,
        notify,
      });

    it("says nothing about a view nobody follows", async () => {
      const person = await anAccount();
      const savedViewId = await aView(person, ofPerson(person));
      await place(person, "1969-07-20T00:00:00.000Z", new Date());

      await sweepOnce(savedViewId);

      assert.deepEqual(await notificationsFor(person), []);
    });

    it("says nothing about a followed view that has gained nothing", async () => {
      const person = await anAccount();
      const savedViewId = await aView(person, ofPerson(person), { followed: true });

      await sweepOnce(savedViewId);

      assert.deepEqual(await notificationsFor(person), []);
    });

    it("tells somebody once, however many times it sweeps", async () => {
      // The behaviour that matters: the sweep recounts the same views for ever,
      // and announcing on every pass would be a notification a minute for one
      // photograph.
      //
      // Two things hold it, and this proves the pair rather than either. While
      // the notification is unread the aggregation key collapses repeats; once
      // it is read the derived event identifier does. The test below reads it
      // first, which is what isolates the second.
      const person = await anAccount();
      const savedViewId = await aView(person, ofPerson(person), { followed: true });
      await place(person, "1969-07-20T00:00:00.000Z", new Date());

      await sweepOnce(savedViewId);
      await sweepOnce(savedViewId);
      await sweepOnce(savedViewId);

      const told = await notificationsFor(person);

      assert.equal(told.length, 1, `told ${told.length} times about one view`);
      assert.equal(told[0]?.source_id, savedViewId);
    });

    it("does not tell somebody again after they read it but before they looked", async () => {
      // The case only the derived identifier can prevent, and the reason it
      // exists. While a notification is unread, the partial unique index on the
      // aggregation key collapses repeats on its own — so a sweep announcing
      // under a fresh identifier every pass would still leave one entry, and
      // would look correct.
      //
      // Reading it frees that key. From then on the *only* thing between an
      // unvisited view and a notification a minute is the event identifier
      // staying the same across the window.
      const person = await anAccount();
      const savedViewId = await aView(person, ofPerson(person), { followed: true });
      await place(person, "1969-07-20T00:00:00.000Z", new Date());

      await sweepOnce(savedViewId);

      await database.dataSource.query(
        `UPDATE notifications SET read_at = now() WHERE recipient_user_id = $1`,
        [person],
      );

      // Requeued rather than visited: they have read the notification but have
      // not opened the view, so the window they were told about is still open.
      await database.dataSource.query(
        `UPDATE saved_view_awareness SET computed_at = NULL WHERE saved_view_id = $1`,
        [savedViewId],
      );

      await sweepOnce(savedViewId);

      const told = await notificationsFor(person);

      assert.equal(told.length, 1, `told ${told.length} times about one unvisited window`);
    });

    it("tells somebody again once they have looked and more has arrived", async () => {
      // Visiting opens a new window. Without that, somebody who read the first
      // notification would never hear about that view again.
      const person = await anAccount();
      const savedViewId = await aView(person, ofPerson(person), { followed: true });
      await place(person, "1969-07-20T00:00:00.000Z", new Date());

      await sweepOnce(savedViewId);

      const visitedAt = new Date();
      await database.dataSource.query(
        `UPDATE saved_views SET last_visited_at = $2 WHERE saved_view_id = $1`,
        [savedViewId, visitedAt],
      );
      await database.dataSource.query(
        `UPDATE saved_view_awareness
            SET new_moment_count = 0, visited_through = $2, computed_at = NULL
          WHERE saved_view_id = $1`,
        [savedViewId, visitedAt],
      );
      // Read, so the unread-collapsing index cannot be what keeps the count at
      // one — otherwise this test would pass without the window having moved.
      await database.dataSource.query(
        `UPDATE notifications SET read_at = now() WHERE recipient_user_id = $1`,
        [person],
      );

      await place(person, "1970-01-01T00:00:00.000Z", new Date());
      await sweepOnce(savedViewId);

      assert.equal((await notificationsFor(person)).length, 2, "a new window said nothing");
    });

    it("says nothing when somebody looked while it was counting", async () => {
      // The count was superseded, so it was not recorded — and they have just
      // seen everything it would have announced.
      const person = await anAccount();
      const savedViewId = await aView(person, ofPerson(person), { followed: true });
      await place(person, "1969-07-20T00:00:00.000Z", new Date());

      const due = await stale(savedViewId);
      const visitedAt = new Date();

      await database.dataSource.query(
        `UPDATE saved_views SET last_visited_at = $2 WHERE saved_view_id = $1`,
        [savedViewId, visitedAt],
      );
      await database.dataSource.query(
        `UPDATE saved_view_awareness SET visited_through = $2 WHERE saved_view_id = $1`,
        [savedViewId, visitedAt],
      );

      await recountOne(due, { dataSource: database.dataSource, savedViews, timeline, notify });

      assert.deepEqual(await notificationsFor(person), []);
    });
  });

  it("forgets what it counted for both sides of a block", async () => {
    const one = await anAccount();
    const other = await anAccount();
    const savedViewId = await aView(one, ofPerson(one));
    const theirs = await aView(other, ofPerson(other));

    for (const id of [savedViewId, theirs]) {
      await database.dataSource.query(
        `UPDATE saved_view_awareness SET new_moment_count = 9, computed_at = now() WHERE saved_view_id = $1`,
        [id],
      );
    }

    await database.dataSource.transaction(async (manager) => {
      await savedViews.forgetFor(manager, [one, other]);
    });

    for (const id of [savedViewId, theirs]) {
      const stored = await storedFor(id);

      assert.equal(stored?.new_moment_count, 0, "a count survived a narrowing");
      assert.equal(stored?.computed_at, null, "a forgotten count was not requeued");
    }
  });
});
