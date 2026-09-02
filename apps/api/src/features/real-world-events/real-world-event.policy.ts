import type { Occurrence, TemporalPrecision } from "@chronologity/contracts";

/**
 * The rules a real-world Event has to satisfy.
 *
 * Pure functions, so they need no database and can be exercised exhaustively.
 * An Event is otherwise a plain record, and this is the only part of it that
 * decides anything.
 *
 * What is deliberately absent is any rule about names. Two Events may carry the
 * same name, an Event may carry several, and none of that is a conflict to
 * resolve here (`real-world-events.md:99-121`).
 */

export type OccurrenceRejection = "interval_reversed" | "instant_not_a_point";

/**
 * The alignment each precision claims about its interval.
 *
 * Only `instant` says anything a check can enforce: it claims a point, so its
 * two ends must be the same. `day`, `month`, and `year` describe how coarsely
 * the time is known, and the interval that expresses it is the caller's to
 * choose — "sometime in 1969" may reasonably be recorded as the whole year or
 * as a narrower window somebody has better information about.
 */
const POINT_PRECISION: TemporalPrecision = "instant";

/**
 * Check that an occurrence's interval and its precision agree.
 *
 * @param occurrence - The interval and the precision claimed for it.
 * @returns The reason to refuse, or undefined when the two agree.
 */
export function checkOccurrence(occurrence: Occurrence): OccurrenceRejection | undefined {
  const start = Date.parse(occurrence.start);
  const end = Date.parse(occurrence.end);

  if (end < start) {
    return "interval_reversed";
  }

  // An instant is a point in time. Given two different ends it is not an
  // instant, and storing it as one would claim a precision nobody has.
  if (occurrence.precision === POINT_PRECISION && end !== start) {
    return "instant_not_a_point";
  }

  return undefined;
}

/**
 * Say why an occurrence was refused.
 *
 * @param reason - What the check found.
 * @returns A message for the person who asked. Both are safe to state plainly:
 *   neither reveals anything about Events somebody else recorded.
 */
export function describeOccurrenceRejection(reason: OccurrenceRejection): string {
  return reason === "interval_reversed"
    ? "An occurrence cannot end before it starts"
    : "An occurrence known to the instant must start and end at the same moment";
}

/**
 * Reduce the names an Event was given to the ones worth storing.
 *
 * @param name - The name it is recorded under.
 * @param aliases - Other names it goes by, if any were supplied.
 * @returns The aliases, trimmed, with blanks, repeats, and anything equal to
 *   the name itself removed. Storing an alias identical to the name would
 *   present the same string twice as though it were two pieces of information;
 *   storing a repeat would do the same and be refused by the primary key
 *   anyway.
 */
export function distinctAliases(name: string, aliases: readonly string[] | undefined): string[] {
  if (aliases === undefined) {
    return [];
  }

  const seen = new Set<string>([name.trim()]);
  const kept: string[] = [];

  for (const alias of aliases) {
    const trimmed = alias.trim();

    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      kept.push(trimmed);
    }
  }

  return kept;
}

/**
 * Reduce the places an Event was given to the ones worth storing.
 *
 * @param locationIds - Whatever was supplied, which may name none.
 * @returns The identifiers with repeats removed, in the order given. Order is
 *   preserved only so the result is predictable; nothing downstream reads it as
 *   a route, and the table does not store it.
 */
export function distinctLocationIds(locationIds: readonly string[] | undefined): string[] {
  return locationIds === undefined ? [] : [...new Set(locationIds)];
}
