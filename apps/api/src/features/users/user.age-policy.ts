/**
 * Minimum account age.
 *
 * The threshold is configuration rather than a constant, because it is a legal
 * question rather than a technical one and the answer differs by jurisdiction:
 * COPPA sets thirteen in the United States, while GDPR Article 8 sets sixteen
 * in the European Union and lets member states lower it to thirteen. A single
 * value cannot express that, so this enforces one global minimum and leaves
 * room for per-jurisdiction rules to be layered on when there is a country
 * signal to base them on.
 *
 * Nothing here reveals the threshold. Someone refused is told they cannot
 * create an account, not what to type instead — an age gate that states its
 * own answer only teaches people the number.
 */

/** The oldest plausible birthdate. Beyond this the input is a mistake or a joke. */
const MAXIMUM_PLAUSIBLE_AGE = 130;

export type AgeRejection = "not_a_date" | "in_the_future" | "implausible" | "below_minimum";

export type AgeCheck =
  | { readonly ok: true; readonly age: number }
  | { readonly ok: false; readonly reason: AgeRejection };

/**
 * Split a calendar date into its parts.
 *
 * @param date - A date in `YYYY-MM-DD` form.
 * @returns Its year, month, and day, or undefined if it is not a real
 *   calendar date. Parsing by hand rather than with `Date` because `Date`
 *   quietly accepts the thirty-first of February and rolls it forward.
 */
function parseCalendarDate(date: string): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  if (match === null) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const asDate = new Date(Date.UTC(year, month - 1, day));

  // Round-tripping catches dates that do not exist: 2026-02-30 becomes March.
  if (
    asDate.getUTCFullYear() !== year ||
    asDate.getUTCMonth() !== month - 1 ||
    asDate.getUTCDate() !== day
  ) {
    return undefined;
  }

  return { year, month, day };
}

/**
 * How old someone born on a date is on a given day.
 *
 * Compared as calendar dates in UTC rather than as instants, because a
 * birthdate is a date everywhere rather than a moment somewhere, and because
 * an age that depends on the reader's time zone would let the same person be
 * old enough for one server and not another.
 *
 * Someone born on the twenty-ninth of February ages on the first of March in
 * years that have no twenty-ninth. That treats them as younger for one extra
 * day, which is the safe direction for a minimum.
 *
 * @param dateOfBirth - A date in `YYYY-MM-DD` form.
 * @param on - The day to measure against.
 * @returns Their age in whole years, or undefined if the birthdate is not a
 *   real calendar date.
 */
export function ageOn(dateOfBirth: string, on: Date): number | undefined {
  const born = parseCalendarDate(dateOfBirth);

  if (born === undefined) {
    return undefined;
  }

  const today = {
    year: on.getUTCFullYear(),
    month: on.getUTCMonth() + 1,
    day: on.getUTCDate(),
  };

  let age = today.year - born.year;

  const hadBirthday =
    today.month > born.month || (today.month === born.month && today.day >= born.day);

  if (!hadBirthday) {
    age -= 1;
  }

  return age;
}

/**
 * Decide whether someone may create an account.
 *
 * @param dateOfBirth - A date in `YYYY-MM-DD` form, as given.
 * @param minimumAge - The configured minimum, in whole years.
 * @param now - The instant to judge against.
 * @returns Their age, or the reason they were refused. The reason is for the
 *   audit trail and the logs; what reaches the person says only that an
 *   account cannot be created.
 */
export function checkAge(dateOfBirth: string, minimumAge: number, now: Date): AgeCheck {
  const age = ageOn(dateOfBirth, now);

  if (age === undefined) {
    return { ok: false, reason: "not_a_date" };
  }

  if (age < 0) {
    return { ok: false, reason: "in_the_future" };
  }

  if (age > MAXIMUM_PLAUSIBLE_AGE) {
    return { ok: false, reason: "implausible" };
  }

  if (age < minimumAge) {
    return { ok: false, reason: "below_minimum" };
  }

  return { ok: true, age };
}

/**
 * What to tell someone whose date of birth was refused.
 *
 * @param reason - Why it was refused.
 * @returns A sentence safe to show them. A malformed date says so, since that
 *   is a typo they can fix. Being below the minimum does not, and reads the
 *   same as an implausible date: stating the threshold turns the gate into
 *   instructions for getting past it.
 */
export function describeAgeRejection(reason: AgeRejection): string {
  switch (reason) {
    case "not_a_date":
      return "Enter your date of birth as a real calendar date";
    case "in_the_future":
      return "Enter your date of birth as a real calendar date";
    default:
      return "An account cannot be created with these details";
  }
}
