import { z } from "zod";

/**
 * How coarsely history is read, and how much one request may sweep.
 *
 * Reading history at a coarse scale returns one row per span rather than one per
 * Moment, so the *answer* is bounded by how much history exists. The **work** is
 * not: a store still reads the whole range whatever it gives back. So a request
 * is measured before it is issued, and one that would sweep too much is refused
 * rather than trimmed — a truncated distribution misstates the shape of
 * somebody's history, and a client cannot tell that it was cut.
 */

/**
 * How coarsely history is being viewed.
 *
 * Finest to coarsest, which is the order somebody zooms out through. Below
 * `day` is the Timeline itself, one Moment per row — a scale is a span of time,
 * and the ungrouped slice is not one.
 *
 * Owned here rather than beside the Timeline contracts because a Saved View
 * stores one too, and a second vocabulary for the same idea is how the two
 * silently diverge: the API already carried a narrower list that mapped four of
 * these to the wrong span.
 */
export const timelineScaleSchema = z.enum(["day", "week", "month", "year", "decade", "century"]);

export type TimelineScale = z.infer<typeof timelineScaleSchema>;

/**
 * How many Moments stand for a span at any scale.
 *
 * Fixed rather than growing with the span, because the number of spans already
 * falls as somebody zooms out. A second rule scaling the count as well would
 * make what reaches the screen depend on two things at once.
 */
export const REPRESENTATIVES_PER_SPAN = 3;

/**
 * The most spans one request may cover.
 *
 * Clears every legitimate request with room to spare — a year of days is 366, a
 * decade of months 120, a century of years 100 — while refusing a decade of days
 * outright. Nothing is lost by the refusal: a coarse read is addressed by range,
 * so a client moving through a long stretch asks for the next part of it as it
 * goes.
 */
export const MAX_SPANS_PER_REQUEST = 400;

/**
 * The earliest instant history may be read from.
 *
 * **Two jobs, and it must not be relaxed for either.** It is the floor of the
 * Timeline projection's own storage — below it an instant does not error, it
 * silently becomes this one — and it is also a Monday, which is what keeps the
 * week arithmetic in the range where integer division is correct. A range
 * reaching further back would bucket wrongly in two different ways at once.
 */
export const HISTORY_FLOOR = new Date("1900-01-01T00:00:00.000Z");

/** Milliseconds in a day. Every scale below is counted in whole UTC days. */
const DAY_MS = 86_400_000;

/** How many calendar years each year-aligned span covers. */
const YEARS_PER_SPAN = { year: 1, decade: 10, century: 100 } as const;

/**
 * Midnight UTC on the day an instant falls in.
 *
 * @param instant - Any instant.
 * @returns Milliseconds since the epoch at that day's start.
 */
function startOfDay(instant: Date): number {
  return Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate());
}

/**
 * Midnight UTC on the Monday on or before an instant.
 *
 * ISO, matching what both stores are made to agree on.
 *
 * @param instant - Any instant.
 * @returns Milliseconds since the epoch at that week's start.
 */
function startOfWeek(instant: Date): number {
  // getUTCDay is 0 on Sunday, so Monday is 1 and Sunday is six days in.
  const sinceMonday = (instant.getUTCDay() + 6) % 7;

  return startOfDay(instant) - sinceMonday * DAY_MS;
}

/**
 * How many spans of a given scale a range covers, inclusive of both ends.
 *
 * Counts every span the range touches rather than the ones holding anything: it
 * answers what a request would sweep, which is what decides whether to issue it,
 * and that cannot depend on data the caller has not read yet.
 *
 * @param from - The earlier end. Its own span counts.
 * @param to - The later end. Its own span counts.
 * @param scale - How coarsely the range is being read.
 * @returns The number of spans, at least one when `to` is not before `from`, and
 *   zero when it is — a backwards range asks for nothing rather than for one
 *   span.
 * @throws {RangeError} If the scale is not one of the six.
 */
export function spansBetween(from: Date, to: Date, scale: TimelineScale): number {
  if (to.getTime() < from.getTime()) {
    return 0;
  }

  switch (scale) {
    case "century":
    case "decade":
    case "year": {
      const years = YEARS_PER_SPAN[scale];
      const first = Math.floor(from.getUTCFullYear() / years);
      const last = Math.floor(to.getUTCFullYear() / years);

      return last - first + 1;
    }

    case "month": {
      const first = from.getUTCFullYear() * 12 + from.getUTCMonth();
      const last = to.getUTCFullYear() * 12 + to.getUTCMonth();

      return last - first + 1;
    }

    case "week":
      return Math.round((startOfWeek(to) - startOfWeek(from)) / (7 * DAY_MS)) + 1;

    case "day":
      return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS) + 1;

    default:
      throw new RangeError(`Unknown timeline scale: ${String(scale)}`);
  }
}
