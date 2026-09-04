import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MAX_SPANS_PER_REQUEST, viewSpecificationSchema, type TimelineScale } from "@chronologity/contracts";
import { describe, it } from "vitest";
import { ValidationError } from "../../lib/errors/validation-error.js";
import type { TimelineEligibilityResolver } from "@chronologity/timeline-derivation";
import type { TimelineReadRepository } from "./timeline.read.repository.js";
import { TimelineService } from "./timeline.service.js";

/**
 * What a request for counts may ask for.
 *
 * The scales this endpoint accepts widened from two to six when temporal zoom
 * arrived, and a scale like `day` over an unbounded stretch is tens of thousands
 * of spans. The read service refuses that; this endpoint must refuse it too, or
 * it becomes the way around the rule — **a bound enforced on one surface and not
 * another is not a bound.**
 *
 * The refusal must also come before any store is reached, since it depends only
 * on what the caller sent.
 */

const PERSON = randomUUID();

/** A repository that fails the test if a request ever reaches it. */
const NO_STORE = {
  ownBuckets: () => {
    throw new Error("ClickHouse was read for a request that should have been refused");
  },
  scopedBuckets: () => {
    throw new Error("ClickHouse was read for a request that should have been refused");
  },
  version: "test",
} as unknown as TimelineReadRepository;

const NO_ELIGIBILITY = {
  resolve: () => {
    throw new Error("eligibility was resolved for a request that should have been refused");
  },
} as unknown as TimelineEligibilityResolver;

const service = new TimelineService(NO_STORE, NO_ELIGIBILITY);

const viewOf = (zoom: TimelineScale, range?: { from: string; to: string }) =>
  viewSpecificationSchema.parse({
    context: { type: "person", id: PERSON },
    zoom,
    ...(range === undefined ? {} : { range: { kind: "fixed", ...range } }),
  });

describe("how many spans a request for counts may produce", () => {
  it("refuses a decade counted day by day, without reading anything", async () => {
    await assert.rejects(
      service.deriveBuckets(PERSON, viewOf("day", {
        from: "2016-01-01T00:00:00.000Z",
        to: "2025-12-31T00:00:00.000Z",
      })),
      ValidationError,
    );
  });

  it("refuses a fine scale over a view naming no stretch of time", async () => {
    // No range means everything history can hold, which at day scale is tens of
    // thousands of spans.
    await assert.rejects(service.deriveBuckets(PERSON, viewOf("day")), ValidationError);
    await assert.rejects(service.deriveBuckets(PERSON, viewOf("week")), ValidationError);
    await assert.rejects(service.deriveBuckets(PERSON, viewOf("month")), ValidationError);
  });

  it("says how many spans were asked for and what to do instead", async () => {
    await assert.rejects(
      service.deriveBuckets(PERSON, viewOf("day", {
        from: "2016-01-01T00:00:00.000Z",
        to: "2025-12-31T00:00:00.000Z",
      })),
      (error: unknown) =>
        error instanceof ValidationError &&
        /3653 spans/.test(error.message) &&
        new RegExp(String(MAX_SPANS_PER_REQUEST)).test(error.message) &&
        /coarser scale/.test(error.message),
    );
  });

  it("admits a rangeless view at the coarse scales, which is what they are for", async () => {
    // These reach the store, which refuses — proving the bound let them through
    // rather than that they were answered.
    for (const scale of ["year", "decade", "century"] as const) {
      await assert.rejects(
        service.deriveBuckets(PERSON, viewOf(scale)),
        (error: unknown) => error instanceof Error && /ClickHouse was read/.test(error.message),
        `${scale} was refused by the bound rather than passed to the store`,
      );
    }
  });

  it("admits a year counted day by day, which is the largest fine request worth making", async () => {
    await assert.rejects(
      service.deriveBuckets(PERSON, viewOf("day", {
        from: "2024-01-01T00:00:00.000Z",
        to: "2024-12-31T00:00:00.000Z",
      })),
      (error: unknown) => error instanceof Error && /ClickHouse was read/.test(error.message),
    );
  });

  it("counts a rolling range from the clock it is given", async () => {
    // Thirty days by day is thirty spans whenever it is asked; the point is that
    // the bound resolves the range rather than treating a rolling view as
    // unbounded.
    const rolling = viewSpecificationSchema.parse({
      context: { type: "person", id: PERSON },
      zoom: "day",
      range: { kind: "rolling", unit: "day", count: 30 },
    });

    await assert.rejects(
      service.deriveBuckets(PERSON, rolling, new Date("2026-09-04T12:00:00.000Z")),
      (error: unknown) => error instanceof Error && /ClickHouse was read/.test(error.message),
    );
  });
});
