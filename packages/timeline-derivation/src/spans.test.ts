import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { TimelineScale } from "@chronologity/contracts";
import {
  clickHouseSpanStart,
  postgresSpanStart,
  WEEK_ANCHOR_DAYS_BEFORE_EPOCH,
  WEEK_STARTS_ON,
} from "./spans.js";

/**
 * Where a span begins, in two dialects that must not drift apart.
 *
 * These assert text rather than behaviour, which is unusual and deliberate. What
 * the expressions actually compute is proved against both engines in the
 * aggregator's agreement suite, because only real engines can prove it. What
 * cannot be proved there is *how* they compute it — and the failures this
 * codebase has already suffered came from reaching for a ClickHouse calendar
 * function that looks right and silently maps pre-epoch history to 1970. So the
 * named functions are pinned here, where a substitution fails immediately rather
 * than in a suite somebody may not run.
 */

const SCALES: readonly TimelineScale[] = [
  "day",
  "week",
  "month",
  "year",
  "decade",
  "century",
];

/** Functions that return `Date`, which cannot hold anything before 1970. */
const SATURATING = ["toStartOfYear", "toStartOfInterval", "toStartOfMonth", "toStartOfDay", "toMonday", "toStartOfWeek"];

describe("clickHouseSpanStart", () => {
  it("aligns a year to its first day", () => {
    assert.equal(
      clickHouseSpanStart("year", "occurred_at"),
      "toDateTime64(concat(toString(toYear(occurred_at, 'UTC')), '-01-01 00:00:00'), 3, 'UTC')",
    );
  });

  it("aligns a decade to the year ending in zero", () => {
    assert.equal(
      clickHouseSpanStart("decade", "occurred_at"),
      "toDateTime64(concat(toString(intDiv(toYear(occurred_at, 'UTC'), 10) * 10), '-01-01 00:00:00'), 3, 'UTC')",
    );
  });

  it("aligns a century to the year ending in two zeros", () => {
    assert.equal(
      clickHouseSpanStart("century", "occurred_at"),
      "toDateTime64(concat(toString(intDiv(toYear(occurred_at, 'UTC'), 100) * 100), '-01-01 00:00:00'), 3, 'UTC')",
    );
  });

  it("aligns a month to its first day, padding a single-digit month", () => {
    assert.equal(
      clickHouseSpanStart("month", "occurred_at"),
      "toDateTime64(concat(toString(toYear(occurred_at, 'UTC')), '-', leftPad(toString(toMonth(occurred_at, 'UTC')), 2, '0'), '-01 00:00:00'), 3, 'UTC')",
    );
  });

  it("aligns a day to its own midnight", () => {
    assert.equal(
      clickHouseSpanStart("day", "occurred_at"),
      "toDateTime64(concat(toString(toYear(occurred_at, 'UTC')), '-', leftPad(toString(toMonth(occurred_at, 'UTC')), 2, '0'), '-', leftPad(toString(toDayOfMonth(occurred_at, 'UTC')), 2, '0'), ' 00:00:00'), 3, 'UTC')",
    );
  });

  it("counts weeks from 1900 rather than from the epoch", () => {
    assert.equal(
      clickHouseSpanStart("week", "occurred_at"),
      "toDateTime64(toDate32(intDiv(toInt32(toDate32(occurred_at, 'UTC')) + 25567, 7) * 7 - 25567), 3, 'UTC')",
    );
  });

  it("never reaches for a calendar function that cannot hold a pre-epoch date", () => {
    for (const scale of SCALES) {
      const expression = clickHouseSpanStart(scale, "occurred_at");

      for (const broken of SATURATING) {
        assert.ok(
          !expression.includes(broken),
          `${scale} uses ${broken}, which returns Date and saturates before 1970`,
        );
      }
    }
  });

  it("reaches before 1970 with Date32 rather than Date", () => {
    const week = clickHouseSpanStart("week", "occurred_at");

    assert.ok(week.includes("toDate32("));
    assert.ok(!/[^23]toDate\(/.test(week));
  });

  it("carries the anchor that keeps the week division away from negative numbers", () => {
    assert.equal(WEEK_ANCHOR_DAYS_BEFORE_EPOCH, 25_567);
    assert.ok(clickHouseSpanStart("week", "occurred_at").includes("25567"));
  });

  it("pins UTC at every scale rather than inheriting the server's zone", () => {
    for (const scale of SCALES) {
      assert.ok(
        clickHouseSpanStart(scale, "occurred_at").includes("'UTC'"),
        `${scale} does not pin UTC`,
      );
    }
  });

  it("reads the column it was given", () => {
    for (const scale of SCALES) {
      assert.ok(clickHouseSpanStart(scale, "neighbour.occurred_at").includes("neighbour.occurred_at"));
    }
  });

  it("refuses a scale that is not one of the six", () => {
    assert.throws(
      () => clickHouseSpanStart("fortnight" as TimelineScale, "occurred_at"),
      RangeError,
    );
  });
});

describe("postgresSpanStart", () => {
  it("aligns a year to its first day", () => {
    assert.equal(
      postgresSpanStart("year", "m.occurrence_start"),
      "make_timestamptz(extract(year FROM m.occurrence_start AT TIME ZONE 'UTC')::int, 1, 1, 0, 0, 0, 'UTC')",
    );
  });

  it("aligns a decade by arithmetic, not by truncation", () => {
    assert.equal(
      postgresSpanStart("decade", "m.occurrence_start"),
      "make_timestamptz(div(extract(year FROM m.occurrence_start AT TIME ZONE 'UTC')::int, 10)::int * 10, 1, 1, 0, 0, 0, 'UTC')",
    );
  });

  it("aligns a century by arithmetic, not by truncation", () => {
    assert.equal(
      postgresSpanStart("century", "m.occurrence_start"),
      "make_timestamptz(div(extract(year FROM m.occurrence_start AT TIME ZONE 'UTC')::int, 100)::int * 100, 1, 1, 0, 0, 0, 'UTC')",
    );
  });

  it("truncates a month, a week and a day, in UTC", () => {
    for (const scale of ["month", "week", "day"] as const) {
      assert.equal(
        postgresSpanStart(scale, "m.occurrence_start"),
        `date_trunc('${scale}', m.occurrence_start, 'UTC')`,
      );
    }
  });

  it("never truncates a decade or a century, which follow a different convention here", () => {
    for (const scale of SCALES) {
      const expression = postgresSpanStart(scale, "m.occurrence_start");

      assert.ok(!expression.includes("date_trunc('century'"));
      assert.ok(!expression.includes("date_trunc('decade'"));
    }
  });

  it("starts a week on the day the other dialect was made to match", () => {
    assert.equal(WEEK_STARTS_ON, "monday");
    assert.equal(
      postgresSpanStart("week", "m.occurrence_start"),
      "date_trunc('week', m.occurrence_start, 'UTC')",
    );
  });

  it("pins UTC at every scale rather than inheriting the session's zone", () => {
    for (const scale of SCALES) {
      assert.ok(
        postgresSpanStart(scale, "m.occurrence_start").includes("'UTC'"),
        `${scale} does not pin UTC`,
      );
    }
  });

  it("reads the expression it was given", () => {
    for (const scale of SCALES) {
      assert.ok(postgresSpanStart(scale, "candidate.started").includes("candidate.started"));
    }
  });

  it("refuses a scale that is not one of the six", () => {
    assert.throws(
      () => postgresSpanStart("fortnight" as TimelineScale, "m.occurrence_start"),
      RangeError,
    );
  });
});
