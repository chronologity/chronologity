import type { Env } from "./env.js";

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
  readonly magicLinkBaseUrl: string;
}

export function toAuthConfig(env: Env): AuthConfig {
  return {
    jwtSecret: new TextEncoder().encode(env.AUTH_JWT_SECRET),
    issuer: env.AUTH_JWT_ISSUER,
    audience: env.AUTH_JWT_AUDIENCE,
    accessTokenTtlSeconds: env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: env.AUTH_REFRESH_TOKEN_TTL_SECONDS,
    magicLinkTtlSeconds: env.AUTH_MAGIC_LINK_TTL_SECONDS,
    magicLinkBaseUrl: env.AUTH_MAGIC_LINK_BASE_URL,
  };
}
