/**
 * Telling somebody when something happened.
 *
 * **Precision is carried, and must be honoured.** A Moment known only as "summer
 * 1998" is stored as an interval at `month` precision and, as
 * `moments.md:583` puts it, "never acquires a fabricated exact timestamp".
 * Rendering it as "14 June 1998" invents a day nobody knows —
 * `moments.md:259`: "The product should not create false precision." The
 * previous code called `toDateString()` on everything, which did exactly that,
 * and did it in a fixed American format regardless of who was reading.
 *
 * **Locale and time zone come from the reader**, because they are presentation.
 * `users.md:448` keeps the two apart: "Presentation preferences must remain
 * separate from historical occurrence data." Both preferences are nullable in
 * the contract, and null means *follow the device* — which is not the same as
 * any particular value, so neither is defaulted to a guess.
 *
 * **An occurrence without an offset is a real case, not a defect.** A withheld
 * entry deliberately carries no `occurrenceOffsetMinutes` (ADR-140): an offset
 * says something about where somebody was, and that is the one part of an
 * occurrence that leaks place rather than time. Such a Moment can be placed in
 * history and cannot be given a local wall clock, so this never pretends
 * otherwise.
 */

/**
 * An ISO-8601 instant, which is what the contracts promise.
 *
 * Checked by shape rather than by asking `Date` whether it liked the string.
 * `new Date("summer 1998")` does not fail — it answers 1 January 1998, having
 * found a year in the noise — so a malformed occurrence would arrive on screen
 * as a confident wrong date rather than as an error. GraphQL responses are not
 * parsed against a schema the way REST ones are (ADR-154), so this is the place
 * that catches it.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Parse an occurrence, refusing anything that is not one.
 *
 * @param iso - The timestamp from the wire.
 * @returns The instant it names.
 * @throws {RangeError} If it is not an ISO-8601 instant, or names no real time.
 */
function instant(iso: string): Date {
  if (!ISO_INSTANT.test(iso)) {
    throw new RangeError(`${iso} is not an ISO-8601 timestamp`);
  }

  const when = new Date(iso);

  if (Number.isNaN(when.getTime())) {
    throw new RangeError(`${iso} names no real time`);
  }

  return when;
}

/** How exactly an occurrence is known. Mirrors the wire enum. */
export type Precision = "INSTANT" | "DAY" | "MONTH" | "YEAR";

/** Who is reading, and where they keep time. */
export interface Reader {
  /** BCP 47, or undefined to follow the device. */
  readonly locale?: string | undefined;
  /** IANA time zone, or undefined to follow the device. */
  readonly timeZone?: string | undefined;
}

/**
 * The date parts to show for a given precision.
 *
 * @param precision - How exactly the occurrence is known.
 * @returns The options to format with. Nothing finer than the precision allows.
 */
function partsFor(precision: Precision): Intl.DateTimeFormatOptions {
  switch (precision) {
    case "YEAR":
      return { year: "numeric" };
    case "MONTH":
      return { month: "long", year: "numeric" };
    case "DAY":
    case "INSTANT":
      return { day: "numeric", month: "long", year: "numeric" };
  }
}

/**
 * When something happened, at the precision it is actually known.
 *
 * @param iso - The occurrence's start, ISO-8601.
 * @param precision - How exactly it is known.
 * @param reader - Their locale and time zone. Both optional; absent follows the
 *   device.
 * @returns The date, with no more precision than is known.
 * @throws {RangeError} If it is not an ISO-8601 timestamp. Refused by shape,
 *   because `Date` accepts noise that contains a year and answers with it.
 */
export function formatOccurrence(iso: string, precision: Precision, reader: Reader = {}): string {
  return new Intl.DateTimeFormat(reader.locale, {
    ...partsFor(precision),
    ...(reader.timeZone === undefined ? {} : { timeZone: reader.timeZone }),
  }).format(instant(iso));
}

/**
 * The time of day, where there is one to tell.
 *
 * @param iso - The occurrence's start.
 * @param precision - How exactly it is known.
 * @param reader - Their locale and time zone.
 * @returns The time, or undefined when the occurrence is not known to an
 *   instant — in which case there is no time of day to state, and stating one
 *   would be inventing it.
 * @throws {RangeError} If it is not an ISO-8601 timestamp.
 */
export function formatTimeOfDay(
  iso: string,
  precision: Precision,
  reader: Reader = {},
): string | undefined {
  if (precision !== "INSTANT") {
    return undefined;
  }

  return new Intl.DateTimeFormat(reader.locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...(reader.timeZone === undefined ? {} : { timeZone: reader.timeZone }),
  }).format(instant(iso));
}
