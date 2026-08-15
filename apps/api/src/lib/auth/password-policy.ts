import type { PasswordPolicyConfig } from "../../config/auth-config.js";
import { isBreachedPassword } from "./breached-passwords.js";

/**
 * What Chronologity will accept as a password.
 *
 * Length is the control that matters. Composition rules — one uppercase, one
 * digit, one symbol — push people toward predictable patterns and measurably
 * weaken the result, which is why `security.md:340` asks for resistance to
 * guessing "without encouraging predictable composition patterns" and this
 * imposes none.
 *
 * The maximum exists only to bound work. Argon2's cost is fixed by its
 * parameters rather than by input length, but an unbounded field is still an
 * unbounded allocation on an unauthenticated endpoint.
 */

export type PasswordRejection =
  "too_short" | "too_long" | "too_common" | "breached" | "contains_email";

export type PasswordCheck =
  { readonly ok: true } | { readonly ok: false; readonly reason: PasswordRejection };

/**
 * Passwords common enough to refuse on sight.
 *
 * Kept alongside the far larger breach corpus because this list catches
 * decorated variants — "P@ssw0rd-123!" is not in any leak verbatim, but it is
 * "password" wearing a hat. The corpus catches what has actually leaked; this
 * catches what someone has just made up along the same lines.
 */
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty",
  "qwerty123",
  "abc123",
  "letmein",
  "welcome",
  "welcome1",
  "monkey",
  "dragon",
  "iloveyou",
  "admin",
  "administrator",
  "football",
  "baseball",
  "sunshine",
  "princess",
  "changeme",
  "trustno1",
  "passw0rd",
  "correcthorsebatterystaple",
  "chronologity",
]);

/**
 * Character substitutions people use to dress up a weak password.
 *
 * "P@ssw0rd" is "password" to anyone cracking it — every wordlist tool applies
 * these mappings automatically — so the check has to see through them. Deleting
 * the symbols instead would turn "P@ssw0rd" into "pssw0rd" and miss the match
 * entirely.
 */
const LEET_SUBSTITUTIONS: Readonly<Record<string, string>> = {
  "@": "a",
  "4": "a",
  "8": "b",
  "(": "c",
  "3": "e",
  "6": "g",
  "1": "i",
  "!": "i",
  "|": "i",
  "0": "o",
  "5": "s",
  $: "s",
  "7": "t",
  "+": "t",
  "2": "z",
};

/** Normalised for comparison only. The password itself is never altered. */
function normalizeForComparison(password: string): string {
  return password
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, "");
}

/** The same, after undoing common character substitutions. */
function deleetify(password: string): string {
  const substituted = password
    .trim()
    .toLowerCase()
    .split("")
    .map((character) => LEET_SUBSTITUTIONS[character] ?? character)
    .join("");

  return substituted.replaceAll(/[^a-z0-9]/g, "");
}

/**
 * Every form of a password worth comparing against the list.
 *
 * Trailing digits are the other common decoration, and they add almost
 * nothing: "password123" falls about as fast as "password".
 */
function comparisonForms(password: string): string[] {
  const forms = new Set<string>();

  // Trailing decoration is removed from the raw string *before* substitutions
  // are undone, not after. Undoing them first turns the "123" in "P@ssw0rd-123!"
  // into letters, which then look like part of the word rather than the
  // decoration they are.
  const withoutTrailingDecoration = password.trim().replace(/[\d\W_]+$/, "");

  for (const source of [password, withoutTrailingDecoration]) {
    for (const base of [normalizeForComparison(source), deleetify(source)]) {
      forms.add(base);
      forms.add(base.replace(/\d+$/, ""));
    }
  }

  forms.delete("");

  return [...forms];
}

/**
 * Whether a password is a trivial pattern regardless of its length.
 *
 * A long password built from one repeated character or from digits alone has
 * far less entropy than its length suggests, and no wordlist needs to contain
 * it for it to fall quickly. NIST permits blocking repetitive and sequential
 * strings; this is not a composition rule, since nothing is *required*.
 */
function isTrivialPattern(password: string): boolean {
  const trimmed = password.trim();

  if (/^\d+$/.test(trimmed)) {
    return true;
  }

  return new Set(trimmed).size === 1;
}

/**
 * Decide whether a password is acceptable.
 *
 * Returns a reason rather than throwing, because the caller decides what to
 * tell whom: registration can explain the problem, while a reset flow may need
 * to stay quieter.
 */
export function checkPassword(
  config: PasswordPolicyConfig,
  password: string,
  email?: string | undefined,
): PasswordCheck {
  if (password.length < config.minimumLength) {
    return { ok: false, reason: "too_short" };
  }

  if (password.length > config.maximumLength) {
    return { ok: false, reason: "too_long" };
  }

  if (isTrivialPattern(password)) {
    return { ok: false, reason: "too_common" };
  }

  if (comparisonForms(password).some((form) => COMMON_PASSWORDS.has(form))) {
    return { ok: false, reason: "too_common" };
  }

  // Checked last: it is the most expensive of these, and the cheap structural
  // checks have already removed most of what would fail here anyway.
  if (isBreachedPassword(password)) {
    return { ok: false, reason: "breached" };
  }

  // The local part of an address is among the first things guessed for the
  // account it belongs to.
  if (email !== undefined) {
    const localPart = normalizeForComparison(email.split("@")[0] ?? "");

    if (localPart.length >= 4 && normalizeForComparison(password).includes(localPart)) {
      return { ok: false, reason: "contains_email" };
    }
  }

  return { ok: true };
}

/** What to tell someone whose password was refused. */
export function describeRejection(reason: PasswordRejection, config: PasswordPolicyConfig): string {
  switch (reason) {
    case "too_short":
      return `Password must be at least ${config.minimumLength} characters`;
    case "too_long":
      return `Password must be at most ${config.maximumLength} characters`;
    case "too_common":
      return "That password is too easily guessed";
    case "breached":
      // Said plainly rather than euphemistically. Someone whose password has
      // leaked should know, because they have almost certainly used it
      // somewhere else too.
      return "That password has appeared in a known data breach and cannot be used";
    case "contains_email":
      return "Password must not contain your email address";
    default:
      return "Password is not acceptable";
  }
}
