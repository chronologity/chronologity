import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  byPartitionBudget,
  contextsNeedingRoom,
  momentsNeedingRoom,
  MAXIMUM_PARTITIONS_PER_BLOCK,
  type StoredContextRow,
  type StoredMomentRow,
} from "./timeline-batch.js";

/**
 * Deciding what a batch must clear out of its way.
 *
 * A `ReplacingMergeTree` collapses rows that share a sort key, keeping the
 * newest — so writing over a Moment needs no delete at all, provided the new row
 * lands on the same sort key as the old one. A delete is required exactly when
 * it would not: when the sort key changed, and the stale row would therefore sit
 * beside the new one for ever rather than being collapsed into it.
 *
 * Getting this wrong is expensive in both directions. Delete too eagerly and
 * every page pays a mutation, which is the cost this whole change exists to
 * remove. Delete too little and a Moment is shown twice, at two dates or at two
 * places, permanently.
 */

const MOMENT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PLACE = "33333333-3333-4333-8333-333333333333";
const ELSEWHERE = "44444444-4444-4444-8444-444444444444";
const PERSON = "55555555-5555-4555-8555-555555555555";

const at = (iso: string) => new Date(iso).getTime();
const SUMMER = at("1969-07-20T00:00:00.000Z");
const AUTUMN = at("1998-10-01T00:00:00.000Z");

const stored = (over: Partial<StoredMomentRow> = {}): StoredMomentRow => ({
  momentId: MOMENT,
  occurredAtMs: SUMMER,
  ...over,
});

const storedContext = (over: Partial<StoredContextRow> = {}): StoredContextRow => ({
  momentId: MOMENT,
  contextType: "person",
  contextId: PERSON,
  occurredAtMs: SUMMER,
  ...over,
});

describe("what a batch must clear out of its way", () => {
  it("asks for no room when a Moment is already where it belongs", () => {
    // The ordinary case, and the one the whole change turns on. A rebuild that
    // asked for room here would pay a mutation for every Moment it rewrote.
    const room = momentsNeedingRoom([stored()], new Map([[MOMENT, SUMMER]]));

    assert.deepEqual([...room], []);
  });

  it("asks for room when a Moment's occurrence has been corrected", () => {
    // The one case that genuinely needs a delete. Occurrence leads the sort key
    // and the table partitions by its year, so the old row lands in a different
    // partition and can never merge with the new one.
    const room = momentsNeedingRoom([stored({ occurredAtMs: AUTUMN })], new Map([[MOMENT, SUMMER]]));

    assert.deepEqual([...room], [MOMENT]);
  });

  it("asks for room when a Moment is stored at two occurrences at once", () => {
    // The state a delete that was missed once already left behind. Reading only
    // the first row would leave it there for ever.
    const room = momentsNeedingRoom(
      [stored({ occurredAtMs: SUMMER }), stored({ occurredAtMs: AUTUMN })],
      new Map([[MOMENT, SUMMER]]),
    );

    assert.deepEqual([...room], [MOMENT]);
  });

  it("asks for nothing when the projection holds nothing", () => {
    // A rebuild into a fresh version. Every page would otherwise open with a
    // delete against an empty table.
    assert.deepEqual([...momentsNeedingRoom([], new Map([[MOMENT, SUMMER]]))], []);
  });

  it("leaves a Moment it was not asked about alone", () => {
    // The probe reads by identifier, so it can only return what was asked for —
    // but a rule that deleted anything it merely saw would be a hazard worth
    // refusing outright.
    const room = momentsNeedingRoom(
      [stored({ momentId: OTHER, occurredAtMs: AUTUMN })],
      new Map([[MOMENT, SUMMER]]),
    );

    assert.deepEqual([...room], []);
  });
});

describe("what a batch must clear out of its way, among contexts", () => {
  const desired = (contexts: readonly { type: string; id: string }[], occurredAtMs = SUMMER) =>
    new Map([[MOMENT, { occurredAtMs, contexts }]]);

  it("asks for no room when a Moment's contexts are unchanged", () => {
    const room = contextsNeedingRoom(
      [storedContext()],
      desired([{ type: "person", id: PERSON }]),
    );

    assert.deepEqual([...room], []);
  });

  it("asks for no room when a Moment has gained a context", () => {
    // Somebody accepted a participation. The existing rows are all still wanted,
    // and the new one lands on its own sort key, so nothing is in the way.
    const room = contextsNeedingRoom(
      [storedContext()],
      desired([
        { type: "person", id: PERSON },
        { type: "location", id: PLACE },
      ]),
    );

    assert.deepEqual([...room], []);
  });

  it("asks for room when a Moment has left a context", () => {
    // The case a check on occurrence alone cannot see: a Location was corrected,
    // an Event unlinked, a participation withdrawn. The occurrence is untouched,
    // so the stale row would never be collapsed and the Moment would show at
    // both places for ever.
    const room = contextsNeedingRoom(
      [storedContext({ contextType: "location", contextId: PLACE }), storedContext()],
      desired([
        { type: "person", id: PERSON },
        { type: "location", id: ELSEWHERE },
      ]),
    );

    assert.deepEqual([...room], [MOMENT]);
  });

  it("asks for room when a Moment's contexts moved with it", () => {
    // Context rows carry the Moment's occurrence too, so a corrected date moves
    // every one of them to a new sort key.
    const room = contextsNeedingRoom(
      [storedContext({ occurredAtMs: AUTUMN })],
      desired([{ type: "person", id: PERSON }]),
    );

    assert.deepEqual([...room], [MOMENT]);
  });

  it("asks for nothing when the projection holds no contexts", () => {
    assert.deepEqual([...contextsNeedingRoom([], desired([{ type: "person", id: PERSON }]))], []);
  });
});

describe("splitting a batch so ClickHouse will accept it", () => {
  const rowsAcross = (years: number, perYear = 1) =>
    Array.from({ length: years * perYear }, (_value, index) => ({
      year: 1900 + Math.floor(index / perYear),
    }));

  it("leaves a batch that spans few years in one piece", () => {
    const chunks = byPartitionBudget(rowsAcross(3, 200), (row) => row.year);

    assert.equal(chunks.length, 1, "a dense page was split for no reason");
    assert.equal(chunks[0]?.length, 600);
  });

  it("never puts more than the permitted number of years in one piece", () => {
    // ClickHouse refuses a block spanning more partitions than this, and every
    // row's partition is the year it happened in.
    const chunks = byPartitionBudget(rowsAcross(MAXIMUM_PARTITIONS_PER_BLOCK + 20), (row) => row.year);

    for (const chunk of chunks) {
      assert.ok(
        new Set(chunk.map((row) => row.year)).size <= MAXIMUM_PARTITIONS_PER_BLOCK,
        "a piece spanned more years than ClickHouse will accept",
      );
    }
  });

  it("loses and duplicates nothing when it splits", () => {
    const rows = rowsAcross(MAXIMUM_PARTITIONS_PER_BLOCK + 20, 2);
    const chunks = byPartitionBudget(rows, (row) => row.year);

    assert.equal(
      chunks.reduce((total, chunk) => total + chunk.length, 0),
      rows.length,
      "splitting changed how many rows there were",
    );
  });

  it("splits on how many years it spans, not on how many rows it holds", () => {
    // A hundred rows spanning a hundred and fifty years must still be split, and
    // ten thousand rows in one year must not be.
    const sparse = byPartitionBudget(rowsAcross(MAXIMUM_PARTITIONS_PER_BLOCK + 50), (row) => row.year);
    const dense = byPartitionBudget(rowsAcross(1, 10_000), (row) => row.year);

    assert.ok(sparse.length > 1, "a page spanning centuries was left whole");
    assert.equal(dense.length, 1, "a page from a single year was split by row count");
  });

  it("holds nothing back when there is nothing to split", () => {
    assert.deepEqual(byPartitionBudget([], (row: { year: number }) => row.year), []);
  });
});
