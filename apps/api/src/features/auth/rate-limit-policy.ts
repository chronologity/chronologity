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
  readonly windowMinutes: number;
}

export const defaultAuthRateLimits: AuthRateLimits = {
  magicLinkRequestsPerWindow: 5,
  sessionCreationsPerWindow: 10,
  windowMinutes: 15,
};
