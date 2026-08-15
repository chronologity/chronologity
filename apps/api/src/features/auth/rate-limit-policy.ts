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
  /** Registration also sends mail to a caller-chosen address. */
  readonly registrationsPerWindow: number;
  readonly windowMinutes: number;
}

export const defaultAuthRateLimits: AuthRateLimits = {
  magicLinkRequestsPerWindow: 5,
  sessionCreationsPerWindow: 10,
  passwordAttemptsPerWindow: 10,
  registrationsPerWindow: 5,
  windowMinutes: 15,
};
