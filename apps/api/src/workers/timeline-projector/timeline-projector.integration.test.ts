import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { TimelineProjector } from "../../features/timeline/timeline.projector.js";
import { TimelineRepository } from "../../features/timeline/timeline.repository.js";
import { rebuildTimeline } from "../../features/timeline/timeline.rebuild.js";
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
      (await contextsOf(momentId)).map((row) => row.context_id),
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
    assert.equal((await contextsOf(momentId)).length, 1);

    await database.dataSource.query(
      `INSERT INTO moderation_states (subject_type, subject_id, state, reason, decided_at)
       VALUES ('moment', $1, 'removed', 'projector integration test', now())
       ON CONFLICT (subject_type, subject_id) DO UPDATE SET state = 'removed'`,
      [momentId],
    );

    await projector.project(momentId);

    assert.deepEqual(await contextsOf(momentId), []);
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
