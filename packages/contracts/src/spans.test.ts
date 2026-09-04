import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  HISTORY_FLOOR,
  MAX_SPANS_PER_REQUEST,
  REPRESENTATIVES_PER_SPAN,
  spansBetween,
  type TimelineScale,
} from "./spans.js";

/**
 * How much a zoomed request would sweep.
 *
 * The counts matter because they decide a refusal, and a refusal that fires one
 * span early or late is the difference between answering somebody's history and
 * declining it. Weeks carry most of the risk: they are the only scale whose
 * boundaries do not fall on a calendar name, so an off-by-one hides until
 * somebody reads a year at that scale.
 */

const at = (iso: string): Date => new Date(iso);

const SCALES: readonly TimelineScale[] = ["day", "week", "month", "year", "decade", "century"];

describe("the bounds a zoomed request is measured against", () => {
  it("stands three Moments for a span", () => {
    assert.equal(REPRESENTATIVES_PER_SPAN, 3);
  });

  it("admits a year of days and refuses a decade of them", () => {
    assert.ok(spansBetween(at("2024-01-01T00:00:00Z"), at("2024-12-31T00:00:00Z"), "day") <= MAX_SPANS_PER_REQUEST);
    assert.ok(spansBetween(at("2016-01-01T00:00:00Z"), at("2025-12-31T00:00:00Z"), "day") > MAX_SPANS_PER_REQUEST);
  });

  it("floors history at a Monday in 1900, because the week arithmetic depends on it", () => {
    assert.equal(HISTORY_FLOOR.toISOString(), "1900-01-01T00:00:00.000Z");
    assert.equal(HISTORY_FLOOR.getUTCDay(), 1);
  });
});

describe("spansBetween", () => {
  it("counts a single span when both ends fall in the same one", () => {
    for (const scale of SCALES) {
      assert.equal(spansBetween(at("2026-09-04T01:00:00Z"), at("2026-09-04T23:00:00Z"), scale), 1, scale);
    }
  });

  it("counts nothing when the range runs backwards", () => {
    for (const scale of SCALES) {
      assert.equal(spansBetween(at("2026-09-04T00:00:00Z"), at("2026-09-01T00:00:00Z"), scale), 0, scale);
    }
  });

  it("counts both spans when the ends are adjacent", () => {
    assert.equal(spansBetween(at("2026-09-04T23:59:59Z"), at("2026-09-05T00:00:00Z"), "day"), 2);
    assert.equal(spansBetween(at("2026-09-30T00:00:00Z"), at("2026-10-01T00:00:00Z"), "month"), 2);
  });

  it("counts a leap year as three hundred and sixty-six days", () => {
    assert.equal(spansBetween(at("2024-01-01T00:00:00Z"), at("2024-12-31T00:00:00Z"), "day"), 366);
  });

  it("counts a leap day as a day of its own", () => {
    assert.equal(spansBetween(at("2024-02-28T00:00:00Z"), at("2024-03-01T00:00:00Z"), "day"), 3);
  });

  it("counts a year as fifty-three weeks", () => {
    assert.equal(spansBetween(at("2024-01-01T00:00:00Z"), at("2024-12-31T00:00:00Z"), "week"), 53);
  });

  it("separates a Sunday from the Monday after it", () => {
    assert.equal(spansBetween(at("1969-12-28T00:00:00Z"), at("1969-12-29T00:00:00Z"), "week"), 2);
  });

  it("counts weeks across the epoch, where the arithmetic changes sign", () => {
    assert.equal(spansBetween(at("1969-12-25T00:00:00Z"), at("1970-01-05T00:00:00Z"), "week"), 3);
  });

  it("counts a week that begins on the floor itself", () => {
    assert.equal(spansBetween(at("1900-01-01T00:00:00Z"), at("1900-01-07T00:00:00Z"), "week"), 1);
  });

  it("counts a decade as a hundred and twenty months", () => {
    assert.equal(spansBetween(at("2016-01-01T00:00:00Z"), at("2025-12-31T00:00:00Z"), "month"), 120);
  });

  it("counts a century as a hundred years", () => {
    assert.equal(spansBetween(at("1901-01-01T00:00:00Z"), at("2000-12-31T00:00:00Z"), "year"), 100);
  });

  it("puts the turn of a decade in two of them", () => {
    assert.equal(spansBetween(at("1969-06-01T00:00:00Z"), at("1970-06-01T00:00:00Z"), "decade"), 2);
  });

  it("puts 1901 and 2026 in two centuries, counting from the year ending in zeros", () => {
    assert.equal(spansBetween(at("1901-06-15T00:00:00Z"), at("2026-09-04T00:00:00Z"), "century"), 2);
  });

  it("keeps a century whole across the year 2000", () => {
    assert.equal(spansBetween(at("1900-01-01T00:00:00Z"), at("1999-12-31T00:00:00Z"), "century"), 1);
    assert.equal(spansBetween(at("1999-12-31T00:00:00Z"), at("2000-01-01T00:00:00Z"), "century"), 2);
  });

  it("counts pre-epoch history the same way as anything else", () => {
    assert.equal(spansBetween(at("1901-01-01T00:00:00Z"), at("1901-12-31T00:00:00Z"), "month"), 12);
    assert.equal(spansBetween(at("1901-06-15T00:00:00Z"), at("1901-06-17T00:00:00Z"), "day"), 3);
  });

  it("refuses a scale that is not one of the six", () => {
    assert.throws(
      () => spansBetween(at("2026-01-01T00:00:00Z"), at("2026-01-02T00:00:00Z"), "fortnight" as TimelineScale),
      RangeError,
    );
  });
});
