import { GraphQLError, Kind, type ValueNode } from "graphql";

/**
 * An instant, as ISO-8601 with an explicit offset.
 *
 * The offset is required rather than optional, and that is the whole reason
 * this is not `String`. `packages/contracts/src/time.ts` puts it plainly:
 * Chronologity records when things happened in the world, and a timestamp
 * without a zone cannot be placed in history without guessing. A Moment
 * recorded as "1998-07-04T19:30:00" is not a fact about history until somebody
 * says where in the world half past seven was.
 *
 * Serialised from a `Date`, which is what the read models produce, and always
 * in UTC. A client that needs the offset the author was at reads
 * `occurrenceOffsetMinutes`, which is a separate field on the Moment for a
 * reason: it is a weak statement about *where* somebody was, so a withheld
 * Moment carries the times and not the offset.
 */

/** ISO-8601 with a zone: `Z`, or `+hh:mm` / `-hh:mm`. */
const WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Read a timestamp a client supplied.
 *
 * @param value - Whatever arrived.
 * @returns The instant it names.
 * @throws {GraphQLError} If it is not a string, carries no offset, or is not a
 *   real instant. A date without a zone is refused rather than assumed to be
 *   UTC: assuming would silently move history by up to fourteen hours.
 */
function parse(value: unknown): Date {
  if (typeof value !== "string") {
    throw refuse("A time is a string in ISO-8601 form");
  }

  if (!WITH_OFFSET.test(value)) {
    throw refuse("A time needs an explicit offset, so it can be placed in history");
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime()) || !isRealCalendarDay(value)) {
    throw refuse("That is not a real instant");
  }

  return parsed;
}

/**
 * Whether the string names a day that existed.
 *
 * Shape and parseability are both insufficient. JavaScript rolls an impossible
 * date over rather than refusing it — `2026-02-30` becomes the 2nd of March,
 * and `2026-02-29` becomes the 1st — so a Moment dated to a day that never
 * happened would be silently moved two days and nothing would say so. For a
 * product whose entire subject is when things happened, that is not a rounding
 * error.
 *
 * Checked on the calendar components as written rather than on the parsed
 * instant, because an offset legitimately moves the UTC day: half past midnight
 * in Berlin is the previous day in UTC, and that is not an error.
 *
 * @param value - The timestamp as supplied.
 * @returns Whether its year, month and day name a real day.
 */
function isRealCalendarDay(value: string): boolean {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);

  if (year === undefined || month === undefined || day === undefined) {
    return false;
  }

  // `setUTCFullYear` rather than `Date.UTC`, which maps a two-digit year into
  // the 1900s — so a Moment in the year 50 would be read as 1950 and refused
  // for not matching itself. Chronologity backfills history, and how far back
  // is not this scalar's business.
  const asUtc = new Date(0);
  asUtc.setUTCFullYear(year, month - 1, day);

  return (
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() === month - 1 &&
    asUtc.getUTCDate() === day
  );
}

/**
 * Build the refusal.
 *
 * @param message - What to tell the client.
 * @returns The error to throw, carrying the code the formatter reads.
 */
function refuse(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "VALIDATION_FAILED" } });
}

/**
 * The `DateTime` scalar's behaviour.
 *
 * A plain object for the same reason the cursor scalar is one: Mercurius
 * attaches a scalar by copying this value's own properties onto the type it
 * built from the SDL.
 */
export const dateTimeScalar = {
  /**
   * Send an instant to a client.
   *
   * @param value - A `Date` from a read model, or a string already in form.
   * @returns The instant in UTC, ISO-8601, with its offset.
   * @throws {GraphQLError} If a resolver produced something that is not an
   *   instant, which is a defect here rather than in the request.
   */
  serialize(value: unknown): string {
    const instant = value instanceof Date ? value : new Date(String(value));

    if (Number.isNaN(instant.getTime())) {
      throw new GraphQLError("A time could not be produced", {
        extensions: { code: "INTERNAL_ERROR" },
      });
    }

    return instant.toISOString();
  },

  /**
   * Read a timestamp supplied as a variable.
   *
   * @param value - The variable's value.
   * @returns The instant it names.
   * @throws {GraphQLError} If it is not a usable instant.
   */
  parseValue(value: unknown): Date {
    return parse(value);
  },

  /**
   * Read a timestamp written into the query document.
   *
   * @param node - The literal, as parsed.
   * @returns The instant it names.
   * @throws {GraphQLError} If it is not a string literal, or not a usable
   *   instant.
   */
  parseLiteral(node: ValueNode): Date {
    if (node.kind !== Kind.STRING) {
      throw refuse("A time is a string in ISO-8601 form");
    }

    return parse(node.value);
  },
};
