import parsePhoneNumber from "libphonenumber-js";

/**
 * One spelling of a phone number.
 *
 * Numbers are written a dozen ways for the same line — `+1 (555) 010-0100`,
 * `+15550100100`, `001 555 010 0100` — and a system that stores what somebody
 * typed will eventually hold two rows for one telephone, which means two
 * accounts for one person or a claim that silently fails to collide.
 *
 * E.164 is the international standard for the canonical form, and reaching it
 * is not simple arithmetic: country calling codes overlap, national prefixes
 * are dropped or kept depending on the country, and lengths vary. That is why
 * this delegates to a library rather than reaching for a regular expression.
 */

/**
 * Reduce a number as typed to its one canonical form.
 *
 * @param input - Whatever somebody typed. Must carry its country, either as a
 *   leading `+` or as an international prefix; there is no default country,
 *   because guessing one would resolve an ambiguous number to the wrong
 *   telephone rather than refusing it.
 * @returns The number in E.164, or undefined when it is not a number that could
 *   be dialled. Undefined rather than a throw: a caller typing badly is an
 *   ordinary outcome of a form, not an exceptional one.
 */
export function normalizePhone(input: string): string | undefined {
  const trimmed = input.trim();

  // Without a country the parse would either fail or, worse, succeed against
  // whatever default was supplied and name a real telephone in the wrong
  // country.
  if (!trimmed.startsWith("+")) {
    return undefined;
  }

  const parsed = parsePhoneNumber(trimmed);

  if (parsed === undefined || !parsed.isValid()) {
    return undefined;
  }

  return parsed.number;
}
