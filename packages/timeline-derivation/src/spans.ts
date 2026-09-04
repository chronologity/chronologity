import type { TimelineScale } from "@chronologity/contracts";

/**
 * Where a span of history begins, in both dialects that need to agree.
 *
 * **Two functions in one file, deliberately.** Temporal zoom counts history in
 * ClickHouse and chooses what represents it in PostgreSQL, and the two answers
 * are joined on the span each row falls in. If the stores disagree about where a
 * week starts, a Moment appears under the wrong row — so the risk is not that
 * either expression is wrong on its own, it is that they drift apart. Keeping
 * them adjacent means nobody can change one without reading the other.
 *
 * Every expression here was measured against the real engines rather than taken
 * from documentation, because the documentation is what misled this codebase
 * before.
 *
 * **ClickHouse's calendar functions cannot be used at all.** `toStartOfYear`,
 * `toStartOfMonth`, `toStartOfDay` and `toMonday` return `Date`, which is
 * `UInt16` days from 1970 and cannot represent anything earlier; a pre-epoch
 * argument saturates to 1970-01-01. Measured on 26.4.5: `toStartOfYear` maps
 * 1901-06-15 to 1970-01-01, and `toMonday` maps 1969-12-25 to the same. Passing
 * `Date32` does not rescue them — they still return `Date`. Since most of the
 * history this product exists to hold predates 1970, the buckets are built from
 * the calendar components instead, which is the technique that was measured
 * correct.
 *
 * **PostgreSQL has no such problem.** It counts microseconds from 2000-01-01 as
 * a signed integer over a proleptic Gregorian calendar, so 1901 truncates
 * exactly as 2001 does. It is the reference the ClickHouse side is proved
 * against — with one exception, noted on `postgresSpanStart`.
 */

/**
 * Which day a week begins on.
 *
 * ISO, so PostgreSQL's `date_trunc('week', …)` is the definition and ClickHouse
 * is made to match it. Recorded as a constant because it is the one convention
 * the two dialects express in completely different ways, and a silent
 * disagreement about it would move Moments between rows rather than fail.
 */
export const WEEK_STARTS_ON = "monday";

/**
 * Days from 1900-01-01 to 1970-01-01, which is what `toDate32` counts from.
 *
 * **The number that removes a whole class of failure.** 1900-01-01 is a Monday
 * *and* it is the earliest instant ClickHouse can hold, so anchoring weeks there
 * makes days-since-anchor non-negative for every representable instant — and
 * `intDiv` truncates toward zero, which is wrong for negatives. Anchoring near
 * the epoch instead is not merely riskier, it is incorrect: measured,
 * `intDiv(-4, 7)` is 0, which puts 1969-12-25 in a week beginning 1969-12-29 —
 * a bucket starting after the Moment inside it.
 *
 * This is why a distribution may not be asked for below the projection floor.
 * The refusal is not an arbitrary restriction; it is what keeps this arithmetic
 * in the range where it is correct.
 */
export const WEEK_ANCHOR_DAYS_BEFORE_EPOCH = 25_567;

/** How many calendar years each year-aligned span covers. */
const YEARS_PER_SPAN = { year: 1, decade: 10, century: 100 } as const;

/**
 * Reject a scale that is not one of the six.
 *
 * @param scale - What the caller passed.
 * @returns Never; it always throws.
 * @throws {RangeError} Always. Callers reach this only by bypassing validation,
 *   and emitting `undefined` into a statement would be worse than failing.
 */
function refuseScale(scale: never): never {
  throw new RangeError(`Unknown timeline scale: ${String(scale)}`);
}

/**
 * Where a span begins, as a ClickHouse expression.
 *
 * The result is a `DateTime64(3, 'UTC')` and is safe to `GROUP BY`. UTC is
 * pinned on both the read and the parse rather than inherited from the server,
 * because the column is declared without a timezone: at day scale a zone slip is
 * a whole bucket wrong rather than a rare edge.
 *
 * @param scale - How coarsely history is being read.
 * @param column - The instant to bucket, already qualified if it needs to be.
 *   Interpolated verbatim, so it must be a column reference this package or its
 *   caller controls, never anything a request supplied.
 * @returns The expression, parenthesised where precedence requires it.
 * @throws {RangeError} If the scale is not one of the six.
 */
export function clickHouseSpanStart(scale: TimelineScale, column: string): string {
  const year = `toYear(${column}, 'UTC')`;
  const month = `leftPad(toString(toMonth(${column}, 'UTC')), 2, '0')`;
  const day = `leftPad(toString(toDayOfMonth(${column}, 'UTC')), 2, '0')`;

  switch (scale) {
    case "century":
    case "decade":
    case "year": {
      const years = YEARS_PER_SPAN[scale];
      const start = years === 1 ? year : `intDiv(${year}, ${years}) * ${years}`;

      return `toDateTime64(concat(toString(${start}), '-01-01 00:00:00'), 3, 'UTC')`;
    }

    case "month":
      return `toDateTime64(concat(toString(${year}), '-', ${month}, '-01 00:00:00'), 3, 'UTC')`;

    case "day":
      return `toDateTime64(concat(toString(${year}), '-', ${month}, '-', ${day}, ' 00:00:00'), 3, 'UTC')`;

    case "week": {
      // Days from 1900-01-01, which is a Monday, so a whole number of weeks from
      // the anchor is always a Monday. `Date32` rather than `Date` because only
      // it reaches before 1970 at all.
      const days = `toInt32(toDate32(${column}, 'UTC'))`;
      const anchored = `${days} + ${WEEK_ANCHOR_DAYS_BEFORE_EPOCH}`;

      return `toDateTime64(toDate32(intDiv(${anchored}, 7) * 7 - ${WEEK_ANCHOR_DAYS_BEFORE_EPOCH}), 3, 'UTC')`;
    }

    default:
      return refuseScale(scale);
  }
}

/**
 * Where a span begins, as a PostgreSQL expression.
 *
 * **`date_trunc` is used for day, week and month, and must never be used for
 * decade or century.** PostgreSQL follows the convention where the twentieth
 * century is 1901–2000, so `date_trunc('century', '1969-06-01')` is 1901-01-01
 * while ClickHouse's arithmetic gives 1900-01-01 — measured, not supposed. The
 * two would disagree about which span most of the twentieth century belongs to.
 * `date_trunc('decade')` happens to agree for the years this product can hold,
 * which makes it more dangerous rather than less: it is one keystroke from the
 * century form and would pass every test that did not reach back far enough.
 *
 * Weeks are the exception to ClickHouse being made to match PostgreSQL's
 * conventions — here `date_trunc('week', …)` is ISO Monday, is what the product
 * wants, and takes no mode argument, so it is the definition and ClickHouse
 * matches it.
 *
 * @param scale - How coarsely history is being read.
 * @param expression - The instant to bucket. Interpolated verbatim, so it must
 *   be a column reference the caller controls, never anything a request
 *   supplied.
 * @returns A `timestamptz` expression, in UTC regardless of the session's zone.
 * @throws {RangeError} If the scale is not one of the six.
 */
export function postgresSpanStart(scale: TimelineScale, expression: string): string {
  switch (scale) {
    case "century":
    case "decade":
    case "year": {
      const years = YEARS_PER_SPAN[scale];
      const year = `extract(year FROM ${expression} AT TIME ZONE 'UTC')::int`;
      // `div` returns numeric, so the cast back is required rather than tidy.
      const start = years === 1 ? year : `div(${year}, ${years})::int * ${years}`;

      return `make_timestamptz(${start}, 1, 1, 0, 0, 0, 'UTC')`;
    }

    case "month":
    case "week":
    case "day":
      return `date_trunc('${scale}', ${expression}, 'UTC')`;

    default:
      return refuseScale(scale);
  }
}
