import type { Env } from "./env.js";

/** Argon2id cost. Raising these migrates stored hashes on next successful login. */
export interface PasswordHashingConfig {
  readonly memoryCostKib: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

/** What Chronologity accepts as a password. Length only; no composition rules. */
export interface PasswordPolicyConfig {
  readonly minimumLength: number;
  readonly maximumLength: number;
}

/**
 * Authentication configuration.
 *
 * The signing secret is held as bytes rather than a string so it is never
 * accidentally interpolated into a log line or an error message.
 */
export interface AuthConfig {
  readonly jwtSecret: Uint8Array;
  readonly issuer: string;
  readonly audience: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
  readonly magicLinkTtlSeconds: number;
  /**
   * How long a code sent by text lasts.
   *
   * Much shorter than a magic link. A link carries 32 random bytes and cannot
   * be guessed; a six-digit code can, so the window in which guessing is
   * possible is kept small.
   */
  readonly phoneCodeTtlSeconds: number;
  readonly magicLinkBaseUrl: string;
  readonly passwordHashing: PasswordHashingConfig;
  readonly passwordPolicy: PasswordPolicyConfig;
}

/**
 * Derive authentication settings from the environment.
 *
 * @param env - The validated environment.
 * @returns Authentication settings. The signing secret is held as bytes rather
 *   than a string so it is never accidentally interpolated into a log line.
 */
export function toAuthConfig(env: Env): AuthConfig {
  return {
    jwtSecret: new TextEncoder().encode(env.AUTH_JWT_SECRET),
    issuer: env.AUTH_JWT_ISSUER,
    audience: env.AUTH_JWT_AUDIENCE,
    accessTokenTtlSeconds: env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: env.AUTH_REFRESH_TOKEN_TTL_SECONDS,
    magicLinkTtlSeconds: env.AUTH_MAGIC_LINK_TTL_SECONDS,
    phoneCodeTtlSeconds: env.AUTH_PHONE_CODE_TTL_SECONDS,
    magicLinkBaseUrl: env.AUTH_MAGIC_LINK_BASE_URL,
    passwordHashing: {
      memoryCostKib: env.AUTH_PASSWORD_MEMORY_COST_KIB,
      timeCost: env.AUTH_PASSWORD_TIME_COST,
      parallelism: env.AUTH_PASSWORD_PARALLELISM,
    },
    passwordPolicy: {
      minimumLength: env.AUTH_PASSWORD_MIN_LENGTH,
      maximumLength: env.AUTH_PASSWORD_MAX_LENGTH,
    },
  };
}
