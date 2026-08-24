/**
 * How hard authentication endpoints may be pushed.
 *
 * Configurable rather than hardcoded because the right number depends on the
 * deployment, and because a test that proves limiting works needs to reach the
 * limit deliberately while every other test needs to stay under it.
 *
 * Requesting a link sends mail to an address the caller chooses, so it is both
 * an enumeration surface and a way to use Chronologity to bother someone. It is
 * limited harder than redeeming one, which requires already holding a token.
 */
export interface AuthRateLimits {
  readonly magicLinkRequestsPerWindow: number;
  readonly sessionCreationsPerWindow: number;
  /**
   * Password attempts. The tightest limit here, because this is the only
   * endpoint an attacker can make progress against by sheer repetition.
   */
  readonly passwordAttemptsPerWindow: number;
  /**
   * Asking for a code by text.
   *
   * The tightest of the request limits. It sends a message to a number the
   * caller chose, which makes it both an enumeration surface and a way to use
   * Chronologity to bother a stranger — and unlike mail, each one may cost the
   * recipient nothing but costs somebody money.
   */
  readonly phoneCodeRequestsPerWindow: number;
  /**
   * Attempts to sign in with a code.
   *
   * A code is six digits, so this is the one endpoint where sheer repetition
   * makes progress. The per-code attempt counter is the real defence; this
   * stops an attacker cycling through fresh codes to refill it.
   */
  readonly phoneCodeAttemptsPerWindow: number;
  /** Registration also sends mail to a caller-chosen address. */
  readonly registrationsPerWindow: number;
  readonly windowMinutes: number;
}

export const defaultAuthRateLimits: AuthRateLimits = {
  magicLinkRequestsPerWindow: 5,
  sessionCreationsPerWindow: 10,
  passwordAttemptsPerWindow: 10,
  registrationsPerWindow: 5,
  phoneCodeRequestsPerWindow: 3,
  phoneCodeAttemptsPerWindow: 10,
  windowMinutes: 15,
};
