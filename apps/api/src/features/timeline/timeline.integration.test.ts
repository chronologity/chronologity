import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createAnalytics, type Analytics } from "../../lib/clickhouse/clickhouse.js";
import { migrateAnalytics } from "../../lib/clickhouse/migrations.js";
import { testAppConfig } from "../../testing/app-config.js";
import { TimelineRepository } from "./timeline.repository.js";
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
