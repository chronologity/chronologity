import type { Env } from "./env.js";

/**
 * What this application needs in order to verify a token.
 *
 * Three values, and no lifetimes: the API decides how long an access token
 * lasts and writes the expiry into the token itself, so a verifier that also
 * held a TTL would be holding a number it must not use. This is the whole of
 * the aggregator's relationship with authentication — it checks a signature and
 * asks whether the Session is still open. It issues nothing.
 *
 * The secret is held as bytes rather than a string so it is never accidentally
 * interpolated into a log line or an error message.
 */
export interface AuthConfig {
  readonly jwtSecret: Uint8Array;
  readonly issuer: string;
  readonly audience: string;
}

/**
 * Derive token-verification settings from the environment.
 *
 * @param env - The validated environment.
 * @returns The signing secret as bytes, and the issuer and audience a token
 *   must claim. All three must match what the API signs with; a mismatch
 *   refuses every authenticated read rather than degrading quietly.
 */
export function toAuthConfig(env: Env): AuthConfig {
  return {
    jwtSecret: new TextEncoder().encode(env.AUTH_JWT_SECRET),
    issuer: env.AUTH_JWT_ISSUER,
    audience: env.AUTH_JWT_AUDIENCE,
  };
}
