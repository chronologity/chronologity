import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { HISTORY_FLOOR } from "@chronologity/contracts";
import { getTemporalDistribution } from "../queries/get-temporal-distribution.query.js";
import { ValidationError } from "../../errors/aggregator-error.js";
import { distributionFor, tooManySpans, type GraphQLScale } from "./distribution-request.js";
import type { TimelineViewArguments } from "./timeline-request.js";
import type { GraphQLContext } from "../../graphql/context/graphql-context.js";

/**
 * Deciding whether a zoomed request can be answered.
 *
 * The refusals matter more than the acceptances. A request too wide for its
 * scale is refused rather than trimmed, and the whole value of that decision is
 * that it happens before a store is touched — so the test that would fail
 * loudest is the one proving no history was read to produce a refusal.
 */

const PERSON = randomUUID();

const view = (over: Partial<TimelineViewArguments> = {}): TimelineViewArguments => ({
  scope: { type: "PERSON", id: PERSON },
  ...over,
});

const between = (from: string, to: string): NonNullable<TimelineViewArguments["range"]> => ({
  fixed: { from: new Date(from), to: new Date(to) },
});

/** A context whose every read model refuses to be reached. */
const NO_STORES = {
  eligibility: {
    forScope: () => {
      throw new Error("eligibility was resolved for a request that should have been refused");
    },
  },
  timeline: {
    buckets: () => {
      throw new Error("ClickHouse was read for a request that should have been refused");
    },
  },
  representatives: {
    choose: () => {
      throw new Error("PostgreSQL was read for a request that should have been refused");
    },
  },
} as unknown as GraphQLContext;

describe("distributionFor", () => {
  it("reads a fixed range at every scale it is offered", () => {
    const scales: GraphQLScale[] = ["DAY", "WEEK", "MONTH", "YEAR", "DECADE", "CENTURY"];

    for (const scale of scales) {
      const request = distributionFor(
        view({ range: between("2026-01-01T00:00:00Z", "2026-01-31T00:00:00Z") }),
        scale,
      );

      assert.equal(request.scale, scale.toLowerCase());
      assert.equal(request.from.toISOString(), "2026-01-01T00:00:00.000Z");
      assert.equal(request.to.toISOString(), "2026-01-31T00:00:00.000Z");
    }
  });

  it("records the scale on the view, so a saved one reopens where it was", () => {
    const request = distributionFor(
      view({ range: between("2026-01-01T00:00:00Z", "2026-01-31T00:00:00Z") }),
      "WEEK",
    );

    assert.equal(request.view.zoom, "week");
  });

  it("pins a rolling range to the instants it resolved to, so both stores read one stretch", () => {
    const now = new Date("2026-09-04T12:00:00.000Z");
    const request = distributionFor(
      view({ range: { rolling: { unit: "DAY", count: 30 } } }),
      "DAY",
      now,
    );

    assert.equal(request.to.toISOString(), now.toISOString());
    assert.equal(request.from.toISOString(), "2026-08-05T12:00:00.000Z");
    assert.deepEqual(request.view.range, {
      kind: "fixed",
      from: "2026-08-05T12:00:00.000Z",
      to: "2026-09-04T12:00:00.000Z",
    });
  });

  it("resolves the same rolling range differently as time passes", () => {
    const rolling = { rolling: { unit: "DAY" as const, count: 30 } };
    const earlier = distributionFor(view({ range: rolling }), "DAY", new Date("2026-09-04T12:00:00Z"));
    const later = distributionFor(view({ range: rolling }), "DAY", new Date("2026-09-05T12:00:00Z"));

    assert.notEqual(earlier.from.getTime(), later.from.getTime());
  });

  it("refuses a view that names no stretch of time", () => {
    assert.throws(() => distributionFor(view(), "DAY"), ValidationError);
  });

  it("refuses a stretch reaching before history is held", () => {
    assert.throws(
      () => distributionFor(view({ range: between("1899-12-31T00:00:00Z", "1901-01-01T00:00:00Z") }), "YEAR"),
      (error: unknown) => error instanceof ValidationError && /1900/.test(error.message),
    );
  });

  it("admits the floor itself", () => {
    const request = distributionFor(
      view({ range: between(HISTORY_FLOOR.toISOString(), "1901-01-01T00:00:00Z") }),
      "YEAR",
    );

    assert.equal(request.from.getTime(), HISTORY_FLOOR.getTime());
  });

  it("refuses a stretch too fine to answer, and says how to ask instead", () => {
    assert.throws(
      () => distributionFor(view({ range: between("2016-01-01T00:00:00Z", "2025-12-31T00:00:00Z") }), "DAY"),
      (error: unknown) =>
        error instanceof ValidationError &&
        /day by day/.test(error.message) &&
        /week by week/.test(error.message),
    );
  });

  it("admits a year of days, which is the largest fine request worth making", () => {
    const request = distributionFor(
      view({ range: between("2024-01-01T00:00:00Z", "2024-12-31T00:00:00Z") }),
      "DAY",
    );

    assert.equal(request.scale, "day");
  });

  it("refuses a decade of days rather than trimming it", () => {
    assert.throws(
      () => distributionFor(view({ range: between("1900-01-01T00:00:00Z", "1910-01-01T00:00:00Z") }), "WEEK"),
      ValidationError,
    );
  });
});

describe("tooManySpans", () => {
  it("names the next coarser way of reading the same stretch", () => {
    assert.match(tooManySpans("day", 3653), /read it week by week/);
    assert.match(tooManySpans("week", 522), /read it month by month/);
    assert.match(tooManySpans("month", 1200), /read it year by year/);
    assert.match(tooManySpans("year", 8100), /read it decade by decade/);
    assert.match(tooManySpans("decade", 810), /read it century by century/);
  });

  it("asks only for a shorter stretch when there is no coarser scale left", () => {
    const message = tooManySpans("century", 500);

    assert.match(message, /shorter stretch/);
    assert.doesNotMatch(message, /read it/);
  });

  it("says how many spans were asked for and how many are answered", () => {
    assert.match(tooManySpans("day", 3653), /3653 spans/);
    assert.match(tooManySpans("day", 3653), /answers 400/);
  });
});

describe("refusing before anything is read", () => {
  it("refuses a stretch too fine to answer without touching either store", async () => {
    await assert.rejects(
      getTemporalDistribution(
        view({ range: between("2016-01-01T00:00:00Z", "2025-12-31T00:00:00Z") }),
        "DAY",
        true,
        NO_STORES,
      ),
      ValidationError,
    );
  });

  it("refuses a view with no range without touching either store", async () => {
    await assert.rejects(getTemporalDistribution(view(), "YEAR", true, NO_STORES), ValidationError);
  });

  it("refuses a stretch before history is held without touching either store", async () => {
    await assert.rejects(
      getTemporalDistribution(
        view({ range: between("1850-01-01T00:00:00Z", "1900-06-01T00:00:00Z") }),
        "YEAR",
        true,
        NO_STORES,
      ),
      ValidationError,
    );
  });
});
