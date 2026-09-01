import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createAnalytics, type Analytics } from "../../lib/clickhouse/clickhouse.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { buildApp } from "../../server/app.js";
import { createTestAuthentication, type TestAuthentication } from "../../testing/authentication.js";
import { UserRepository } from "../users/user.repository.js";
import { UserService } from "../users/user.service.js";
import { migrateAnalytics } from "../../lib/clickhouse/migrations.js";
import { MAILPIT, testAppConfig } from "../../testing/app-config.js";
import { createLocation, createRealWorldEvent } from "../../testing/fixtures.js";
import { TimelineEligibilityResolver } from "./timeline.eligibility.js";
import { TimelineReadRepository } from "./timeline.read.repository.js";
import { TimelineRepository } from "./timeline.repository.js";
import { TimelineService } from "./timeline.service.js";
import { toRecord, type TimelineRow } from "./timeline-row.js";

/**
 * The Timeline projection, against real ClickHouse.
 *
 * Nothing here is stubbed, and the reason is specific rather than dogmatic:
 * every property worth asserting about this table is a property of the engine.
 * Whether a corrected Moment leaves a duplicate, whether two inserts collapse,
 * whether a delete is visible immediately — a fake would answer all three the
 * way its author expected, which is exactly what needs checking.
 *
 * Requires `pnpm infra:up`.
 */

const config = testAppConfig("timeline-integration");

describe("the Timeline projection", () => {
  let analytics: Analytics;
  let timeline: TimelineRepository;
  const version = `test-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    analytics = createAnalytics(config.clickhouse);
    await migrateAnalytics(analytics.client);
    timeline = new TimelineRepository(analytics.client, version);
  });

  afterAll(async () => {
    // A version of its own per run, removed at the end: this table is shared,
    // and a projection version left behind is the ClickHouse equivalent of the
    // sixty-seven thousand stale search rows.
    await analytics.client.command({
      query: `DELETE FROM timeline_moments WHERE projection_version = {version: String}`,
      query_params: { version },
    });
    await analytics.close();
  });

  const summer1998 = (over: Partial<TimelineRow> = {}): TimelineRow => ({
    momentId: randomUUID(),
    authorUserId: randomUUID(),
    occurredAt: new Date("1998-06-01T00:00:00.000Z"),
    recordedAt: new Date(),
    occurrenceEnd: new Date("1998-08-31T23:59:59.000Z"),
    occurrencePrecision: "month",
    occurrenceOffsetMinutes: 0,
    visibility: "public",
    moderationState: "allowed",
    discoverable: true,
    ...over,
  });

  it("holds a Moment where it happened", async () => {
    const row = summer1998();

    await timeline.project(row);

    const stored = await timeline.find(row.momentId);

    assert.equal(stored?.moment_id, row.momentId);
    assert.match(stored?.occurred_at ?? "", /^1998-06-01/);
    assert.equal(stored?.occurrence_precision, "month");
    assert.equal(stored?.visibility, "public");
    assert.equal(stored?.discoverable, 1);
  });

  it("holds one row however often the same Moment is projected", async () => {
    // At-least-once delivery makes this ordinary rather than exceptional.
    const row = summer1998();

    await timeline.project(row);
    await timeline.project(row);
    await timeline.project(row);

    const found = await timeline.inOccurrenceOrder(1_000);

    assert.equal(found.filter((stored) => stored.moment_id === row.momentId).length, 1);
  });

  it("moves a Moment when its occurrence is corrected, and leaves nothing behind", async () => {
    // The case the engine cannot handle alone. `ReplacingMergeTree` collapses
    // rows sharing its sort key, and correcting an occurrence changes the first
    // element of it — so without the delete the Moment sits on the Timeline
    // twice, once where it used to be. Measured: it does.
    const row = summer1998();

    await timeline.project(row);
    await timeline.project({ ...row, occurredAt: new Date("1969-07-20T20:17:00.000Z") });

    const found = (await timeline.inOccurrenceOrder(1_000)).filter(
      (stored) => stored.moment_id === row.momentId,
    );

    assert.equal(found.length, 1, "a corrected Moment is on the Timeline twice");
    assert.match(found[0]?.occurred_at ?? "", /^1969-07-20/);
  });

  it("puts history where it belongs rather than where it was typed", async () => {
    // The whole product, in one assertion. A Moment recorded now that happened
    // in 1969 sorts before one that happened last year.
    const old = summer1998({ occurredAt: new Date("1969-07-20T20:17:00.000Z") });
    const recent = summer1998({ occurredAt: new Date("2020-01-01T00:00:00.000Z") });

    await timeline.project(recent);
    await timeline.project(old);

    const found = (await timeline.inOccurrenceOrder(1_000))
      .filter((stored) => [old.momentId, recent.momentId].includes(stored.moment_id))
      .map((stored) => stored.moment_id);

    assert.deepEqual(found, [old.momentId, recent.momentId]);
  });

  it("separates two Moments that happened at the same instant, the same way every time", async () => {
    // The tie-break, and the reason `moment_id` is stored as text. ClickHouse
    // orders its own `UUID` type by a binary form that disagrees with every
    // string sort — measured, on these very identifiers — so a cursor built
    // outside ClickHouse would page through ties in a different order than the
    // query returns them. Sorting here is what a cursor in 7B will replicate.
    const at = new Date("1977-05-25T00:00:00.000Z");
    const first = summer1998({ occurredAt: at });
    const second = summer1998({ occurredAt: at });
    const expected = [first.momentId, second.momentId].sort();

    await timeline.project(first);
    await timeline.project(second);

    for (const attempt of [1, 2, 3]) {
      const found = (await timeline.inOccurrenceOrder(1_000))
        .filter((stored) => expected.includes(stored.moment_id))
        .map((stored) => stored.moment_id);

      assert.deepEqual(found, expected, `ordering changed on read ${attempt}`);
    }
  });

  it("collapses duplicate rows a race could leave behind", async () => {
    // `project` deletes before inserting, so nothing the single-Moment path does
    // alone can leave two rows. Inserting twice directly is what makes the
    // client's `final = 1` setting observable here.
    //
    // **It is no longer only observable here.** A rebuild now deletes only where
    // a Moment's sort key actually moved (ADR-134), so rebuilding in place
    // deliberately leaves the old rows for a background merge — measured at
    // 4,000 raw rows for 2,000 Moments, with a reader still seeing 2,000. The
    // setting is load-bearing on that path rather than defence in depth, and
    // `timeline-projector.integration.test.ts` proves it through the path that
    // produces it.
    //
    // The race this narrower test defends against is real but narrow: Moment
    // events are partitioned by Moment, so one consumer group cannot project the
    // same Moment twice at once, but a rebuild running beside the live projector
    // can.
    const row = summer1998();

    for (const attempt of [1, 2]) {
      await analytics.client.insert({
        table: "timeline_moments",
        values: [toRecord(row, new Date(2026, 0, attempt), version)],
        format: "JSONEachRow",
      });
    }

    // The raw count first, before anything else touches the table. ClickHouse
    // merges parts on its own schedule, and a merge that lands between the
    // inserts and this read collapses the duplicate before it can be observed
    // — which is what happened in a full run, where this had already passed a
    // dozen times in isolation.
    const stored = await analytics.client.query({
      query: `SELECT count() AS count FROM timeline_moments
               WHERE moment_id = {momentId: String} SETTINGS final = 0`,
      query_params: { momentId: row.momentId },
      format: "JSONEachRow",
    });
    const duplicated = Number((await stored.json<{ count: number }>())[0]?.count);

    // Counted through the configured client rather than with a per-query
    // override, because what matters is what a caller sees.
    const seen = await analytics.client.query({
      query: `SELECT projected_at FROM timeline_moments WHERE moment_id = {momentId: String}`,
      query_params: { momentId: row.momentId },
      format: "JSONEachRow",
    });
    const visible = await seen.json<{ projected_at: string }>();

    // One row either way, which is the guarantee. What the raw count decides is
    // whether the *engine* or the *setting* produced it — and only the second
    // is what this test exists to prove, so it says which happened rather than
    // claiming credit for a merge.
    assert.equal(visible.length, 1, "a caller sees the Moment twice");
    assert.match(visible[0]?.projected_at ?? "", /^2026-01-02/, "the older row won");

    if (duplicated < 2) {
      // A merge got there first. The setting was not exercised, and saying so
      // is better than a green tick that means nothing — this is the one
      // outcome where the assertions above prove less than they appear to.
      console.warn("timeline: parts merged before the read; deduplication was not exercised");
    }

    await timeline.remove(row.momentId);
  });

  it("takes a Moment off the Timeline when it is erased", async () => {
    const row = summer1998();

    await timeline.project(row);
    await timeline.remove(row.momentId);

    assert.equal(await timeline.find(row.momentId), undefined);
  });

  it("takes everything an account contributed", async () => {
    const authorUserId = randomUUID();
    const theirs = [summer1998({ authorUserId }), summer1998({ authorUserId })];
    const somebodyElse = summer1998();

    for (const row of [...theirs, somebodyElse]) {
      await timeline.project(row);
    }

    await timeline.removeEverythingBy(authorUserId);

    for (const row of theirs) {
      assert.equal(await timeline.find(row.momentId), undefined);
    }

    assert.notEqual(await timeline.find(somebodyElse.momentId), undefined, "took the wrong rows");
  });
});

describe("navigating your own history", () => {
  let database: Database;
  let analytics: Analytics;
  let timeline: TimelineRepository;
  let service: TimelineService;
  const version = `nav-${randomUUID().slice(0, 8)}`;
  const author = randomUUID();
  const somebodyElse = randomUUID();

  /**
   * Four Moments across a century, deliberately including history from before
   * the epoch. Most of a Timeline is older than 1970, and the two bucketing
   * functions ClickHouse offers for this both break there — `toStartOfYear`
   * turned 1901 into 1970, and `toStartOfInterval(..., INTERVAL 10 YEAR)` put
   * the moon landing in 2139. Fixtures made of recent dates would have passed.
   */
  const history = [
    { at: "1901-03-05T00:00:00.000Z", id: randomUUID() },
    { at: "1969-07-20T20:17:00.000Z", id: randomUUID() },
    { at: "1998-06-01T00:00:00.000Z", id: randomUUID() },
    { at: "2020-01-01T00:00:00.000Z", id: randomUUID() },
  ];

  beforeAll(async () => {
    // Your own history never consults the resolver — every Moment here is
    // yours, and the rule that lets you read it needs nothing from PostgreSQL.
    // The connection exists so the service is built the way production builds
    // it, rather than with a stand-in that could drift.
    database = createDatabase(config.database);
    await connectDatabase(database);

    analytics = createAnalytics(config.clickhouse);
    await migrateAnalytics(analytics.client);
    timeline = new TimelineRepository(analytics.client, version);
    service = new TimelineService(
      new TimelineReadRepository(analytics.client, version),
      new TimelineEligibilityResolver(database.dataSource),
    );

    // Both stores, because a person's Timeline is read from the person context
    // rather than by author: the projector writes both together and a fixture
    // that wrote only the row would produce an empty Timeline for everything
    // below.
    const place = async (row: TimelineRow) => {
      await timeline.project(row);
      await timeline.projectContexts(row, [{ type: "person", id: row.authorUserId }]);
    };

    for (const entry of history) {
      await place({
        momentId: entry.id,
        authorUserId: author,
        occurredAt: new Date(entry.at),
        recordedAt: new Date(),
        occurrenceEnd: new Date(entry.at),
        occurrencePrecision: "day",
        occurrenceOffsetMinutes: 0,
        visibility: "private",
        moderationState: "allowed",
        discoverable: false,
      });
    }

    // Somebody else's history, at the same instants, so that a query which
    // forgot to scope to one person would return it and be caught.
    for (const entry of history) {
      await place({
        momentId: randomUUID(),
        authorUserId: somebodyElse,
        occurredAt: new Date(entry.at),
        recordedAt: new Date(),
        occurrenceEnd: new Date(entry.at),
        occurrencePrecision: "day",
        occurrenceOffsetMinutes: 0,
        visibility: "public",
        moderationState: "allowed",
        discoverable: true,
      });
    }
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

  const idsOf = (page: { moments: readonly { momentId: string }[] }) =>
    page.moments.map((moment) => moment.momentId);

  it("opens at the newest occurrence, not the newest recording", async () => {
    // Every fixture was projected just now, in the order written above — so a
    // head that sorted by when the row was written would answer 2020 by luck.
    // Projecting the oldest last is what makes this assertion mean something.
    const head = await service.head(author);

    assert.equal(head?.momentId, history[3]!.id);
  });

  it("walks back through history a page at a time", async () => {
    const first = await service.page(author, { limit: 2 });

    assert.deepEqual(idsOf(first), [history[3]!.id, history[2]!.id]);
    assert.notEqual(first.cursor, undefined, "there is more history and no cursor to reach it");

    const second = await service.page(author, { cursor: first.cursor, limit: 2 });

    assert.deepEqual(idsOf(second), [history[1]!.id, history[0]!.id]);
    assert.equal(second.cursor, undefined, "history ended and a cursor was offered anyway");
  });

  it("continues in either direction from any page it hands out", async () => {
    // `timeline.md:808` asks that navigation not be asymmetric, and a page with
    // one cursor is exactly that: it continues backwards and cannot come
    // forwards. Writing this test is what showed it — the first version
    // expected the forward page from the trailing cursor to be the page just
    // read, and it cannot be, because that cursor names the far end.
    const back = await service.page(author, { limit: 2 });

    assert.deepEqual(idsOf(back), [history[3]!.id, history[2]!.id]);

    // Onwards, from the trailing edge.
    const older = await service.page(author, { cursor: back.cursor, limit: 2 });

    assert.deepEqual(idsOf(older), [history[1]!.id, history[0]!.id]);

    // And back towards the present, from the leading edge of that same page.
    const newer = await service.page(author, {
      cursor: older.reverseCursor,
      direction: "newer",
      limit: 2,
    });

    assert.deepEqual(idsOf(newer), [history[2]!.id, history[3]!.id]);
  });

  it("never returns somebody else's history, whatever cursor it is given", async () => {
    // The cursor is the only client-supplied value reaching the query, and this
    // sub-phase's entire authorization story is the author filter. A cursor
    // naming somebody else's position must page through your own history from
    // that point, not theirs.
    const theirs = await service.page(somebodyElse, { limit: 4 });
    const mine = await service.page(author, { cursor: theirs.cursor, limit: 4 });

    for (const momentId of idsOf(mine)) {
      assert.ok(
        history.some((entry) => entry.id === momentId),
        "a Timeline returned a Moment belonging to somebody else",
      );
    }
  });

  it("lands on the nearest Moment to a time nothing happened at", async () => {
    const around = await service.around(author, new Date("1975-01-01T00:00:00.000Z"), 2);

    // 1969 is six years back; 1998 is twenty-three years forward.
    assert.equal(around.at?.momentId, history[1]!.id);
    assert.deepEqual(idsOf(around.older), [history[0]!.id]);
    assert.deepEqual(idsOf(around.newer), [history[2]!.id, history[3]!.id]);
  });

  it("lands on the earliest when asked about a time before all of it", async () => {
    const around = await service.around(author, new Date("1800-01-01T00:00:00.000Z"), 2);

    assert.equal(around.at?.momentId, history[0]!.id);
    assert.deepEqual(idsOf(around.older), []);
  });

  it("answers a Viewer with no history rather than failing", async () => {
    const around = await service.around(randomUUID(), new Date(), 2);

    assert.equal(around.at, undefined);
    assert.deepEqual(idsOf(around.older), []);
    assert.deepEqual(idsOf(around.newer), []);
  });

  it("counts history by decade, including the decades before 1970", async () => {
    // The assertion that would have caught both bucketing defects. ClickHouse's
    // interval arithmetic counts from the epoch, so 1969 came back as 2139 and
    // 1901 as 1970 — correct for everything recent, wrong for most of history.
    const buckets = await service.buckets(author, "decade");
    const decades = buckets.map((bucket) => bucket.startsAt.getUTCFullYear());

    assert.deepEqual(decades, [1900, 1960, 1990, 2020]);
    assert.deepEqual(
      buckets.map((bucket) => bucket.count),
      [1, 1, 1, 1],
    );
  });

  it("counts history by year, including years before 1970", async () => {
    const buckets = await service.buckets(author, "year");

    assert.deepEqual(
      buckets.map((bucket) => bucket.startsAt.getUTCFullYear()),
      [1901, 1969, 1998, 2020],
    );
  });

  it("counts only what the pages contain", async () => {
    // The two surfaces must agree: a decade showing three Moments that pages
    // as two is a Timeline that contradicts itself.
    const buckets = await service.buckets(author, "decade");
    const everything = await service.page(author, { limit: 100 });

    assert.equal(
      buckets.reduce((total, bucket) => total + bucket.count, 0),
      everything.moments.length,
    );
  });

  it("refuses a page size beyond the ceiling", async () => {
    await assert.rejects(() => service.page(author, { limit: 10_000 }), /page holds/);
    await assert.rejects(() => service.page(author, { limit: 0 }), /page holds/);
  });

  it("refuses a cursor it did not issue", async () => {
    await assert.rejects(() => service.page(author, { cursor: "not-a-cursor" }), /cursor/);
  });
});

describe("the Timeline over HTTP", () => {
  let app: FastifyInstance;
  let database: Database;
  let analytics: Analytics;
  let authentication: TestAuthentication;
  let timeline: TimelineRepository;
  const version = `http-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    analytics = createAnalytics(config.clickhouse);
    await migrateAnalytics(analytics.client);
    timeline = new TimelineRepository(analytics.client, version);

    authentication = createTestAuthentication(database.dataSource, config.auth, config.email);

    app = await buildApp({
      config,
      dependencies: [],
      authentication,
      users: new UserService(database.dataSource, new UserRepository(database.dataSource), {
        minimumAgeYears: config.minimumAgeYears,
      }),
      timeline: new TimelineService(
        new TimelineReadRepository(analytics.client, version),
        new TimelineEligibilityResolver(database.dataSource),
      ),
    });
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
    const email = `person-${randomUUID()}@example.test`;
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
      payload: {
        handle: `h${randomUUID().replaceAll("-", "").slice(0, 12)}`,
        displayName: "Chronicler",
        dateOfBirth: "1990-04-12",
      },
    });

    assert.equal(created.statusCode, 201, created.body);

    return { accessToken: credentials.accessToken as string, userId: created.json().userId };
  };

  /** Somebody with three Moments across a century. */
  const withHistory = async () => {
    const person = await onboard();

    for (const at of ["1901-03-05", "1969-07-20", "2020-01-01"]) {
      const row = {
        momentId: randomUUID(),
        authorUserId: person.userId,
        occurredAt: new Date(`${at}T00:00:00.000Z`),
        recordedAt: new Date(),
        occurrenceEnd: new Date(`${at}T00:00:00.000Z`),
        occurrencePrecision: "day" as const,
        occurrenceOffsetMinutes: 0,
        visibility: "private" as const,
        moderationState: "allowed",
        discoverable: false,
      };

      await timeline.project(row);
      await timeline.projectContexts(row, [{ type: "person", id: person.userId }]);
    }

    return person;
  };

  it("hands back a page and a cursor that fetches the next", async () => {
    const person = await withHistory();

    const first = await app.inject({
      method: "GET",
      url: "/timeline?limit=2",
      headers: authed(person.accessToken),
    });

    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().moments.length, 2);

    const next = await app.inject({
      method: "GET",
      url: `/timeline?limit=2&cursor=${encodeURIComponent(first.json().cursor)}`,
      headers: authed(person.accessToken),
    });

    assert.equal(next.statusCode, 200, next.body);
    assert.equal(next.json().moments.length, 1);
    assert.equal(next.json().cursor, undefined, "history ended and a cursor was offered");
  });

  it("opens where the Timeline opens", async () => {
    const person = await withHistory();

    const head = await app.inject({
      method: "GET",
      url: "/timeline/head",
      headers: authed(person.accessToken),
    });

    assert.equal(head.statusCode, 200, head.body);
    assert.match(head.json().occurredAt, /^2020-01-01/);
  });

  it("answers somebody with no history rather than failing", async () => {
    const person = await onboard();

    const page = await app.inject({
      method: "GET",
      url: "/timeline",
      headers: authed(person.accessToken),
    });

    assert.equal(page.statusCode, 200, page.body);
    assert.deepEqual(page.json().moments, []);

    const head = await app.inject({
      method: "GET",
      url: "/timeline/head",
      headers: authed(person.accessToken),
    });

    assert.equal(head.statusCode, 200);
    assert.equal(head.json(), null);
  });

  it("jumps to a time and brings back what surrounds it", async () => {
    const person = await withHistory();

    const around = await app.inject({
      method: "GET",
      url: "/timeline/around?at=1975-01-01T00:00:00.000Z&limit=5",
      headers: authed(person.accessToken),
    });

    assert.equal(around.statusCode, 200, around.body);
    assert.match(around.json().at.occurredAt, /^1969-07-20/);
    assert.equal(around.json().older.moments.length, 1);
    assert.equal(around.json().newer.moments.length, 1);
  });

  it("counts history by decade, including before 1970", async () => {
    const person = await withHistory();

    const buckets = await app.inject({
      method: "GET",
      url: "/timeline/buckets?scale=decade",
      headers: authed(person.accessToken),
    });

    assert.equal(buckets.statusCode, 200, buckets.body);
    assert.deepEqual(
      buckets.json().buckets.map((bucket: { startsAt: string }) => bucket.startsAt.slice(0, 4)),
      ["1900", "1960", "2020"],
    );
  });

  it("refuses a request with no session", async () => {
    assert.equal((await app.inject({ method: "GET", url: "/timeline" })).statusCode, 401);
  });

  it("refuses a cursor it did not issue", async () => {
    const person = await withHistory();

    const forged = await app.inject({
      method: "GET",
      url: "/timeline?cursor=not-a-real-cursor",
      headers: authed(person.accessToken),
    });

    // A refusal, not a five hundred and not somebody else's history.
    assert.equal(forged.statusCode, 400, forged.body);
  });

  /**
   * Put a Moment at a place and, optionally, an occasion.
   *
   * Written to both stores. The projection is what the Timeline reads, and
   * PostgreSQL is what eligibility reads — a fixture in one only would make
   * every rule here pass for the wrong reason.
   */
  const placeAt = async (
    scopes: { locationId?: string; realWorldEventId?: string },
    author: string,
    year: number,
    over: Partial<TimelineRow> = {},
  ): Promise<string> => {
    const momentId = randomUUID();
    const row: TimelineRow = {
      momentId,
      authorUserId: author,
      occurredAt: new Date(`${year}-06-01T00:00:00.000Z`),
      recordedAt: new Date(),
      occurrenceEnd: new Date(`${year}-06-01T00:00:00.000Z`),
      occurrencePrecision: "day",
      occurrenceOffsetMinutes: 0,
      visibility: "public",
      moderationState: "allowed",
      discoverable: true,
      ...over,
    };

    await database.dataSource.query(
      `INSERT INTO moments (moment_id, author_user_id, caption, occurrence_start,
                            occurrence_end, occurrence_precision, occurrence_offset_minutes,
                            visibility, discoverable, created_at, updated_at)
       VALUES ($1, $2, 'fixture', $3, $3, 'day', 0, $4, true, now(), now())`,
      [momentId, row.authorUserId, row.occurredAt, row.visibility],
    );

    if (scopes.locationId !== undefined) {
      await database.dataSource.query(
        `INSERT INTO moment_locations (moment_id, location_id) VALUES ($1, $2)`,
        [momentId, scopes.locationId],
      );
    }

    if (scopes.realWorldEventId !== undefined) {
      await database.dataSource.query(
        `INSERT INTO moment_real_world_events (moment_id, real_world_event_id) VALUES ($1, $2)`,
        [momentId, scopes.realWorldEventId],
      );
    }

    await timeline.project(row);
    await timeline.projectContexts(row, [
      ...(scopes.locationId === undefined
        ? []
        : [{ type: "location" as const, id: scopes.locationId }]),
      ...(scopes.realWorldEventId === undefined
        ? []
        : [{ type: "real_world_event" as const, id: scopes.realWorldEventId }]),
      // The author's own row, as the projector writes it. Without this the
      // Moment reaches no Timeline at all, and every assertion below would
      // pass or fail for a reason unrelated to what it is testing.
      { type: "person" as const, id: author },
    ]);

    return momentId;
  };

  const idsIn = (body: { moments: { momentId: string }[] }) =>
    body.moments.map((moment) => moment.momentId);

  it("shows a place's history to somebody who was never there", async () => {
    const author = await onboard();
    const stranger = await onboard();
    const locationId = await createLocation(database.dataSource, author.userId);
    const momentId = await placeAt({ locationId }, author.userId, 1999);

    const page = await app.inject({
      method: "GET",
      url: `/locations/${locationId}/timeline`,
      headers: authed(stranger.accessToken),
    });

    assert.equal(page.statusCode, 200, page.body);
    assert.deepEqual(idsIn(page.json()), [momentId]);
  });

  it("shows the same place differently to two people", async () => {
    // The point of the whole sub-phase, over HTTP: eligibility is applied
    // inside the query, so what comes back differs by who asked and neither
    // page carries a trace of what the other saw.
    const author = await onboard();
    const stranger = await onboard();
    const locationId = await createLocation(database.dataSource, author.userId);
    const open = await placeAt({ locationId }, author.userId, 1990);
    const closed = await placeAt({ locationId }, author.userId, 1991, { visibility: "private" });

    const theirs = await app.inject({
      method: "GET",
      url: `/locations/${locationId}/timeline`,
      headers: authed(author.accessToken),
    });
    const others = await app.inject({
      method: "GET",
      url: `/locations/${locationId}/timeline`,
      headers: authed(stranger.accessToken),
    });

    assert.deepEqual(idsIn(theirs.json()).sort(), [open, closed].sort());
    assert.deepEqual(idsIn(others.json()), [open]);
  });

  it("counts a place's history the same way it pages it", async () => {
    // A count that disagreed with the page would advertise what the page
    // withheld: twelve in a bucket where four can be opened says eight exist.
    const author = await onboard();
    const stranger = await onboard();
    const locationId = await createLocation(database.dataSource, author.userId);

    await placeAt({ locationId }, author.userId, 1980);
    await placeAt({ locationId }, author.userId, 1981, { visibility: "private" });

    const buckets = await app.inject({
      method: "GET",
      url: `/locations/${locationId}/timeline/buckets?scale=decade`,
      headers: authed(stranger.accessToken),
    });

    assert.equal(buckets.statusCode, 200, buckets.body);
    assert.deepEqual(
      buckets.json().buckets.map((bucket: { startsAt: string; count: number }) => [
        bucket.startsAt.slice(0, 4),
        bucket.count,
      ]),
      [["1980", 1]],
    );
  });

  it("opens a place's Timeline at the newest Moment the Viewer may see", async () => {
    // Not the newest Moment there. A head naming something they cannot open
    // would disclose that it exists, and roughly when.
    const author = await onboard();
    const stranger = await onboard();
    const locationId = await createLocation(database.dataSource, author.userId);

    await placeAt({ locationId }, author.userId, 1970);
    await placeAt({ locationId }, author.userId, 2010, { visibility: "private" });

    const head = await app.inject({
      method: "GET",
      url: `/locations/${locationId}/timeline/head`,
      headers: authed(stranger.accessToken),
    });

    assert.equal(head.statusCode, 200, head.body);
    assert.match(head.json().occurredAt, /^1970-06-01/);
  });

  it("lands a jump on something the Viewer may open", async () => {
    const author = await onboard();
    const stranger = await onboard();
    const locationId = await createLocation(database.dataSource, author.userId);

    const open = await placeAt({ locationId }, author.userId, 1960);
    await placeAt({ locationId }, author.userId, 1975, { visibility: "private" });

    const around = await app.inject({
      method: "GET",
      url: `/locations/${locationId}/timeline/around?at=1976-01-01T00:00:00.000Z`,
      headers: authed(stranger.accessToken),
    });

    assert.equal(around.statusCode, 200, around.body);
    assert.equal(around.json().at.momentId, open, "a jump landed on a withheld Moment");
  });

  it("answers a place a Viewer may see nothing in, rather than refusing", async () => {
    // Refusing would itself say there is something there. An empty Timeline is
    // indistinguishable from a place nothing was ever recorded at, which is the
    // point.
    const author = await onboard();
    const stranger = await onboard();
    const locationId = await createLocation(database.dataSource, author.userId);

    await placeAt({ locationId }, author.userId, 1995, { visibility: "private" });

    const page = await app.inject({
      method: "GET",
      url: `/locations/${locationId}/timeline`,
      headers: authed(stranger.accessToken),
    });
    const head = await app.inject({
      method: "GET",
      url: `/locations/${locationId}/timeline/head`,
      headers: authed(stranger.accessToken),
    });

    assert.equal(page.statusCode, 200, page.body);
    assert.deepEqual(page.json().moments, []);
    assert.equal(head.statusCode, 200);
    assert.equal(head.json(), null);
  });

  it("answers a place that does not exist the same way as an empty one", async () => {
    // A Location nobody has recorded and one a Viewer may see nothing in must
    // be indistinguishable, or existence itself becomes readable.
    const stranger = await onboard();

    const page = await app.inject({
      method: "GET",
      url: `/locations/${randomUUID()}/timeline`,
      headers: authed(stranger.accessToken),
    });

    assert.equal(page.statusCode, 200, page.body);
    assert.deepEqual(page.json().moments, []);
  });

  describe("a view, rather than a query", () => {
    it("shows only what somebody recorded, or only what they took part in", async () => {
      // Perspective. The same context, three answers: their history is what
      // they recorded together with what they agreed to, and "what my father
      // photographed" and "where my father was" are different questions.
      const author = await onboard();
      const participant = await onboard();
      const theirs = await participatedIn(participant.userId, participant.userId, 2001);
      const shared = await participatedIn(author.userId, participant.userId, 2002);

      const idsFor = async (perspective: string) => {
        const page = await app.inject({
          method: "GET",
          url: `/timeline?perspective=${perspective}`,
          headers: authed(participant.accessToken),
        });

        assert.equal(page.statusCode, 200, page.body);

        return page.json().moments.map((moment: { momentId: string }) => moment.momentId).sort();
      };

      assert.deepEqual(await idsFor("all"), [theirs, shared].sort());
      assert.deepEqual(await idsFor("authored"), [theirs]);
      assert.deepEqual(await idsFor("participated"), [shared]);
    });

    it("refuses a lens a place cannot have", async () => {
      const person = await onboard();
      const locationId = await createLocation(database.dataSource, person.userId);

      const refused = await app.inject({
        method: "GET",
        url: `/locations/${locationId}/timeline?perspective=authored`,
        headers: authed(person.accessToken),
      });

      // Refused rather than ignored: a view that quietly meant something other
      // than it said would be worse than one that failed.
      assert.equal(refused.statusCode, 400, refused.body);
    });

    it("narrows a person's history to one place", async () => {
      // "My father's photographs in Tokyo" — a person as the context and a
      // place as the filter, which is the kind of view this exists for.
      const person = await onboard();
      const locationId = await createLocation(database.dataSource, person.userId);
      const there = await placeAt({ locationId }, person.userId, 1995);
      await placeAt({}, person.userId, 1996);

      const page = await app.inject({
        method: "GET",
        url: `/timeline?locationId=${locationId}`,
        headers: authed(person.accessToken),
      });

      assert.deepEqual(
        page.json().moments.map((moment: { momentId: string }) => moment.momentId),
        [there],
      );
    });

    it("refuses a filter naming what the view is already about", async () => {
      const person = await onboard();
      const locationId = await createLocation(database.dataSource, person.userId);

      const refused = await app.inject({
        method: "GET",
        url: `/locations/${locationId}/timeline?locationId=${locationId}`,
        headers: authed(person.accessToken),
      });

      assert.equal(refused.statusCode, 400, refused.body);
    });

    it("bounds a view by when history happened", async () => {
      const person = await onboard();
      const sixties = await placeAt({}, person.userId, 1969);
      await placeAt({}, person.userId, 1999);

      const page = await app.inject({
        method: "GET",
        url: "/timeline?from=1960-01-01T00:00:00.000Z&to=1969-12-31T00:00:00.000Z",
        headers: authed(person.accessToken),
      });

      assert.deepEqual(
        page.json().moments.map((moment: { momentId: string }) => moment.momentId),
        [sixties],
      );
    });

    it("counts what the view holds, not what the context does", async () => {
      // A count and its page must agree. A bucket that ignored the narrowing
      // would promise Moments the pages beneath it never produce.
      const person = await onboard();
      const locationId = await createLocation(database.dataSource, person.userId);

      await placeAt({ locationId }, person.userId, 1980);
      await placeAt({}, person.userId, 1981);

      const buckets = await app.inject({
        method: "GET",
        url: `/timeline/buckets?scale=decade&locationId=${locationId}`,
        headers: authed(person.accessToken),
      });

      assert.deepEqual(
        buckets.json().buckets.map((bucket: { count: number }) => bucket.count),
        [1],
      );
    });

    it("opens where the view opens, not where the context does", async () => {
      const person = await onboard();
      const locationId = await createLocation(database.dataSource, person.userId);
      const there = await placeAt({ locationId }, person.userId, 1970);

      await placeAt({}, person.userId, 2010);

      const head = await app.inject({
        method: "GET",
        url: `/timeline/head?locationId=${locationId}`,
        headers: authed(person.accessToken),
      });

      // The newest thing *in the view*. A head that ignored the narrowing would
      // name a Moment the view does not contain.
      assert.equal(head.json().momentId, there);
    });
  });


  it("navigates a real-world Event's history the same way", async () => {
    const author = await onboard();
    const stranger = await onboard();
    const realWorldEventId = await createRealWorldEvent(database.dataSource, author.userId);

    const open = await placeAt({ realWorldEventId }, author.userId, 1985);
    await placeAt({ realWorldEventId }, author.userId, 1986, { visibility: "private" });

    const page = await app.inject({
      method: "GET",
      url: `/real-world-events/${realWorldEventId}/timeline`,
      headers: authed(stranger.accessToken),
    });

    assert.equal(page.statusCode, 200, page.body);
    assert.deepEqual(idsIn(page.json()), [open]);
  });

  it("keeps a place's Moments out of an Event's Timeline", async () => {
    // The scope is part of the sort key rather than a filter applied after, so
    // this is the test that the key is being used the way it is written.
    const author = await onboard();
    const locationId = await createLocation(database.dataSource, author.userId);
    const realWorldEventId = await createRealWorldEvent(database.dataSource, author.userId);

    await placeAt({ locationId }, author.userId, 1940);

    const page = await app.inject({
      method: "GET",
      url: `/real-world-events/${realWorldEventId}/timeline`,
      headers: authed(author.accessToken),
    });

    assert.deepEqual(page.json().moments, []);
  });

  /**
   * Put a Moment on somebody's Timeline as a participation.
   *
   * Written the way the projector writes it — the row, plus a person context
   * for the author and one for the participant — so what is under test is the
   * read rather than a shape invented here.
   */
  const participatedIn = async (
    authorUserId: string,
    participantUserId: string,
    year: number,
    over: Partial<TimelineRow> = {},
  ): Promise<string> => {
    const row: TimelineRow = {
      momentId: randomUUID(),
      authorUserId,
      occurredAt: new Date(`${year}-06-01T00:00:00.000Z`),
      recordedAt: new Date(),
      occurrenceEnd: new Date(`${year}-06-01T00:00:00.000Z`),
      occurrencePrecision: "day",
      occurrenceOffsetMinutes: 0,
      visibility: "public",
      moderationState: "allowed",
      discoverable: true,
      ...over,
    };

    await timeline.project(row);
    await timeline.projectContexts(row, [
      { type: "person", id: authorUserId },
      { type: "person", id: participantUserId },
    ]);

    return row.momentId;
  };

  it("puts a Moment somebody agreed to on their own Timeline", async () => {
    const author = await onboard();
    const participant = await onboard();
    const momentId = await participatedIn(author.userId, participant.userId, 1994);

    const page = await app.inject({
      method: "GET",
      url: "/timeline",
      headers: authed(participant.accessToken),
    });

    assert.equal(page.statusCode, 200, page.body);
    assert.deepEqual(
      page.json().moments.map((moment: { momentId: string }) => moment.momentId),
      [momentId],
      "a Moment they were part of is missing from their own history",
    );
  });

  it("shows one they cannot read as its date and nothing else", async () => {
    // Being named is not being admitted. They accepted, so they are entitled to
    // know it happened — their own history should not have a hole they cannot
    // see the shape of — but what it says stays shut.
    const author = await onboard();
    const participant = await onboard();

    await participatedIn(author.userId, participant.userId, 1995, { visibility: "private" });

    const page = await app.inject({
      method: "GET",
      url: "/timeline",
      headers: authed(participant.accessToken),
    });

    const [entry] = page.json().moments;

    assert.equal(entry.readable, false, "a private Moment came back readable");
    assert.match(entry.occurredAt, /^1995-06-01/);
    assert.equal(entry.visibility, undefined, "visibility leaked");
    assert.equal(entry.discoverable, undefined, "discoverability leaked");
    // A UTC offset says something about where somebody was rather than when.
    assert.equal(entry.occurrenceOffsetMinutes, undefined, "the offset leaked");
  });

  it("counts what it cannot show", async () => {
    // A bucket that left out the redacted ones would disagree with the pages
    // beneath it, and somebody scrolling a decade would find Moments the count
    // said were not there.
    const author = await onboard();
    const participant = await onboard();

    await participatedIn(author.userId, participant.userId, 1960, { visibility: "private" });

    const buckets = await app.inject({
      method: "GET",
      url: "/timeline/buckets?scale=decade",
      headers: authed(participant.accessToken),
    });

    assert.deepEqual(
      buckets.json().buckets.map((bucket: { startsAt: string; count: number }) => [
        bucket.startsAt.slice(0, 4),
        bucket.count,
      ]),
      [["1960", 1]],
    );
  });

  it("shows a stranger only what the Moment itself would have shown them", async () => {
    const author = await onboard();
    const participant = await onboard();
    const stranger = await onboard();

    const open = await participatedIn(author.userId, participant.userId, 1970);
    await participatedIn(author.userId, participant.userId, 1971, { visibility: "private" });

    const page = await app.inject({
      method: "GET",
      url: `/users/${participant.userId}/timeline`,
      headers: authed(stranger.accessToken),
    });

    assert.equal(page.statusCode, 200, page.body);
    assert.deepEqual(
      page.json().moments.map((moment: { momentId: string }) => moment.momentId),
      [open],
      "participation widened somebody else's audience",
    );
  });

  it("never redacts on somebody else's Timeline", async () => {
    // Redaction exists so a person's own history has no invisible hole. To
    // anybody else a Moment they may not read is simply absent, because its
    // existence is not theirs to know.
    const author = await onboard();
    const participant = await onboard();
    const stranger = await onboard();

    await participatedIn(author.userId, participant.userId, 1972, { visibility: "private" });

    const page = await app.inject({
      method: "GET",
      url: `/users/${participant.userId}/timeline`,
      headers: authed(stranger.accessToken),
    });

    assert.deepEqual(page.json().moments, []);
  });

  it("answers a Timeline turned off the same as one with nothing in it", async () => {
    const author = await onboard();
    const participant = await onboard();
    const stranger = await onboard();

    await participatedIn(author.userId, participant.userId, 1980);

    const closed = await app.inject({
      method: "PUT",
      url: "/users/me/preferences",
      headers: authed(participant.accessToken),
      payload: { timelineIsPublic: false },
    });

    // Asserted, because a request that quietly did nothing would leave every
    // assertion below passing for the wrong reason.
    assert.equal(closed.statusCode, 200, closed.body);

    const page = await app.inject({
      method: "GET",
      url: `/users/${participant.userId}/timeline`,
      headers: authed(stranger.accessToken),
    });
    const buckets = await app.inject({
      method: "GET",
      url: `/users/${participant.userId}/timeline/buckets?scale=decade`,
      headers: authed(stranger.accessToken),
    });

    assert.equal(page.statusCode, 200, page.body);
    assert.deepEqual(page.json().moments, [], "a closed Timeline still handed history out");
    // A count is a disclosure too: "four hundred Moments you may not see" is
    // exactly what closing it withholds.
    assert.deepEqual(buckets.json().buckets, [], "a closed Timeline still counted itself");
  });

  it("still shows somebody their own Timeline when they have closed it", async () => {
    const author = await onboard();
    const participant = await onboard();
    const momentId = await participatedIn(author.userId, participant.userId, 1985);

    const closed = await app.inject({
      method: "PUT",
      url: "/users/me/preferences",
      headers: authed(participant.accessToken),
      payload: { timelineIsPublic: false },
    });

    // Asserted, because a request that quietly did nothing would leave every
    // assertion below passing for the wrong reason.
    assert.equal(closed.statusCode, 200, closed.body);

    for (const url of ["/timeline", `/users/${participant.userId}/timeline`]) {
      const page = await app.inject({ method: "GET", url, headers: authed(participant.accessToken) });

      assert.deepEqual(
        page.json().moments.map((moment: { momentId: string }) => moment.momentId),
        [momentId],
        `${url} withheld their own history from them`,
      );
    }
  });

  it("refuses a scoped request with no session", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/locations/${randomUUID()}/timeline`,
    });

    assert.equal(response.statusCode, 401);
  });

  it("refuses a scope identifier that is not one", async () => {
    const stranger = await onboard();

    const response = await app.inject({
      method: "GET",
      url: "/locations/not-an-identifier/timeline",
      headers: authed(stranger.accessToken),
    });

    assert.equal(response.statusCode, 400, response.body);
  });

  it("refuses a page larger than the ceiling", async () => {
    const person = await withHistory();

    const greedy = await app.inject({
      method: "GET",
      url: "/timeline?limit=100000",
      headers: authed(person.accessToken),
    });

    assert.equal(greedy.statusCode, 400, greedy.body);
  });
});
