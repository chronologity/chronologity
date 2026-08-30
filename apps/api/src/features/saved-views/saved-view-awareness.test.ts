import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import type { ViewSpecification } from "@chronologity/contracts";
import {
  budgetFor,
  markFor,
  presentAwareness,
  MAXIMUM_AGE_MS,
  type StoredAwareness,
} from "./saved-view-awareness.js";

/**
 * When a stored count may be shown, and when it must not be.
 *
 * Everything here exists to refuse. A count is computed away from the read path
 * and read back later, so showing it is a claim about the past — and the three
 * refusals below are the only things standing between "we counted 14 once" and
 * telling somebody there are 14 now.
 */

const PERSON = randomUUID();
const NOW = new Date("2026-08-30T12:00:00.000Z");
const VISIT = new Date("2026-08-30T09:00:00.000Z");

const view = (over: Partial<ViewSpecification> = {}) =>
  ({
    derivationVersion: 1,
    context: { type: "person", id: PERSON },
    perspective: "all",
    filters: {},
    position: {},
    limit: 50,
    direction: "older",
    ...over,
  }) as ViewSpecification;

const stored = (over: Partial<StoredAwareness> = {}): StoredAwareness => ({
  newMomentCount: 14,
  capped: false,
  visitedThrough: VISIT,
  computedAt: new Date("2026-08-30T11:00:00.000Z"),
  ...over,
});

describe("showing what a view has gained", () => {
  it("shows a fresh count taken against the visit it is relative to", () => {
    const shown = presentAwareness(stored(), view(), VISIT, NOW);

    assert.equal(shown?.count, 14);
    assert.equal(shown?.capped, false);
    assert.equal(shown?.asOf, "2026-08-30T11:00:00.000Z");
  });

  it("says nothing about a view nothing has counted", () => {
    assert.equal(presentAwareness(undefined, view(), VISIT, NOW), undefined);
    assert.equal(
      presentAwareness(stored({ computedAt: null }), view(), VISIT, NOW),
      undefined,
      "a row that exists but holds no count was reported as a count",
    );
  });

  it("says nothing about a count taken before the last visit", () => {
    // The number means "new since the previous time they looked". Showing it
    // after a fresh visit tells somebody about history they have just been
    // through.
    const shown = presentAwareness(
      stored({ visitedThrough: new Date("2026-08-29T09:00:00.000Z") }),
      view(),
      VISIT,
      NOW,
    );

    assert.equal(shown, undefined);
  });

  it("says nothing about a count taken before anybody had visited", () => {
    // Null on one side and a real instant on the other is still a mismatch:
    // they have looked since, so the number predates the looking.
    assert.equal(presentAwareness(stored({ visitedThrough: null }), view(), VISIT, NOW), undefined);
  });

  it("shows a count for a view nobody has ever visited", () => {
    // Both sides null. The count is relative to when it was saved, which is
    // what somebody who has never opened it should be told about.
    const shown = presentAwareness(stored({ visitedThrough: null }), view(), null, NOW);

    assert.equal(shown?.count, 14);
  });

  it("says nothing about a count older than its budget", () => {
    // The property that survives a dead worker. Eligibility narrows after a
    // count is taken and the sweep is what notices; a worker that has been down
    // must disclose nothing rather than yesterday's numbers.
    const old = new Date(NOW.getTime() - MAXIMUM_AGE_MS - 1);

    assert.equal(presentAwareness(stored({ computedAt: old }), view(), VISIT, NOW), undefined);
  });

  it("shows a count right up to the edge of its budget", () => {
    const edge = new Date(NOW.getTime() - MAXIMUM_AGE_MS);

    assert.equal(presentAwareness(stored({ computedAt: edge }), view(), VISIT, NOW)?.count, 14);
  });

  it("keeps nothing new distinct from not knowing", () => {
    // Two states a client must be able to tell apart: "you are up to date" is a
    // real answer, and absence is not an answer at all.
    const upToDate = presentAwareness(stored({ newMomentCount: 0 }), view(), VISIT, NOW);

    assert.deepEqual(upToDate, { count: 0, capped: false, asOf: "2026-08-30T11:00:00.000Z" });
    assert.notEqual(upToDate, undefined);
  });

  it("carries that counting stopped at the ceiling", () => {
    const shown = presentAwareness(stored({ newMomentCount: 100, capped: true }), view(), VISIT, NOW);

    assert.equal(shown?.count, 100);
    assert.equal(shown?.capped, true, "a capped count was presented as exact");
  });
});

describe("how long a count stays worth showing", () => {
  it("gives a fixed view the full budget", () => {
    assert.equal(budgetFor(view()), MAXIMUM_AGE_MS);
    assert.equal(
      budgetFor(
        view({
          range: { kind: "fixed", from: "1960-01-01T00:00:00.000Z", to: "1969-12-31T00:00:00.000Z" },
        }),
      ),
      MAXIMUM_AGE_MS,
    );
  });

  it("gives a rolling view less, in proportion to its window", () => {
    // A rolling range expels history as it slides, so its count goes wrong on
    // its own without anything changing in the projection.
    const month = budgetFor(view({ range: { kind: "rolling", unit: "day", count: 30 } }));
    const day = budgetFor(view({ range: { kind: "rolling", unit: "day", count: 1 } }));

    assert.ok(day < month, "a narrower window did not get a shorter budget");
    assert.ok(month <= MAXIMUM_AGE_MS, "a rolling view outlasted the ceiling");
    assert.equal(day, 60 * 60 * 1000, "a view of today should blank within the hour");
  });

  it("never gives a rolling view more than the ceiling", () => {
    assert.equal(
      budgetFor(view({ range: { kind: "rolling", unit: "year", count: 1000 } })),
      MAXIMUM_AGE_MS,
    );
  });

  it("blanks a rolling view while a fixed one of the same age still shows", () => {
    const computedAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    const rolling = view({ range: { kind: "rolling", unit: "day", count: 1 } });

    assert.equal(presentAwareness(stored({ computedAt }), rolling, VISIT, NOW), undefined);
    assert.equal(presentAwareness(stored({ computedAt }), view(), VISIT, NOW)?.count, 14);
  });
});

describe("what a count is measured from", () => {
  it("measures from the last visit when there has been one", () => {
    assert.equal(markFor(new Date("2020-01-01T00:00:00.000Z"), VISIT), VISIT);
  });

  it("measures from when it was saved when there has not", () => {
    // Not the epoch, which would call the whole of history new to somebody who
    // has simply never opened the view.
    const saved = new Date("2020-01-01T00:00:00.000Z");

    assert.equal(markFor(saved, null), saved);
  });
});
