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
    // `project` deletes before inserting, so nothing it does alone can leave
    // two rows — which means the client's `final = 1` setting is invisible to
    // every test above and could be removed without any of them noticing.
    // Inserting twice directly is what makes it observable.
    //
    // The race it defends against is real but narrow: Moment events are
    // partitioned by Moment, so one consumer group cannot project the same
    // Moment twice at once, but a rebuild running beside the live projector
    // can. Defence in depth, and now defence that can be shown to work.
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
    analytics = createAnalytics(config.clickhouse);
    await migrateAnalytics(analytics.client);
    timeline = new TimelineRepository(analytics.client, version);
    service = new TimelineService(new TimelineReadRepository(analytics.client, version));

    for (const entry of history) {
      await timeline.project({
        momentId: entry.id,
        authorUserId: author,
        occurredAt: new Date(entry.at),
        occurrenceEnd: new Date(entry.at),
        occurrencePrecision: "day",
        occurrenceOffsetMinutes: 0,
        visibility: "private",
        moderationState: "allowed",
        discoverable: false,
      });
    }

    // Somebody else's history, at the same instants, so that a query which
    // forgot to filter by author would return it and be caught.
    for (const entry of history) {
      await timeline.project({
        momentId: randomUUID(),
        authorUserId: somebodyElse,
        occurredAt: new Date(entry.at),
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
    await analytics.close();
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
      timeline: new TimelineService(new TimelineReadRepository(analytics.client, version)),
    });
  });

  afterAll(async () => {
    await analytics.client.command({
      query: `DELETE FROM timeline_moments WHERE projection_version = {version: String}`,
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
      await timeline.project({
        momentId: randomUUID(),
        authorUserId: person.userId,
        occurredAt: new Date(`${at}T00:00:00.000Z`),
        occurrenceEnd: new Date(`${at}T00:00:00.000Z`),
        occurrencePrecision: "day",
        occurrenceOffsetMinutes: 0,
        visibility: "private",
        moderationState: "allowed",
        discoverable: false,
      });
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
