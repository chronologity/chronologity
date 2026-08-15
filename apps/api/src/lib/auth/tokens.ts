import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import type { AuthConfig } from "../../config/auth-config.js";

/**
 * Access and refresh credentials.
 *
 * Access tokens are short-lived signed JWTs carrying the minimum needed to
 * identify the Session. Refresh tokens are opaque random values: they are
 * higher-value secrets and gain nothing from being self-describing, so they
 * are stored only as hashes and are meaningless to anyone who reads the
 * database.
 *
 * No token is ever logged, put in an event, or published. The logger redacts
 * these field names, but the real protection is not putting them there.
 */

/** Claims carried by an access token. Deliberately minimal. */
export interface AccessTokenClaims {
  /** Subject: the Identity. The User claim arrives when Users exist, in 5B. */
  readonly identityId: string;
  readonly sessionId: string;
}

export interface IssuedAccessToken {
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * Issue an access token for a Session.
 *
 * Carries no roles or permissions. Authorization state changes faster than a
 * token's lifetime, and a token that asserts permissions cannot be corrected
 * until it expires.
 */
export async function issueAccessToken(
  config: AuthConfig,
  claims: AccessTokenClaims,
  now: Date,
): Promise<IssuedAccessToken> {
  const expiresAt = new Date(now.getTime() + config.accessTokenTtlSeconds * 1000);

  const token = await new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.identityId)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(config.jwtSecret);

  return { token, expiresAt };
}

/**
 * Verify an access token and return its claims.
 *
 * Throws on any failure — bad signature, wrong issuer or audience, expiry.
 * Callers translate that into a single unauthenticated response, because
 * telling a caller which check failed tells an attacker which to fix.
 */
export async function verifyAccessToken(
  config: AuthConfig,
  token: string,
): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, config.jwtSecret, {
    issuer: config.issuer,
    audience: config.audience,
    algorithms: ["HS256"],
  });

  const identityId = payload.sub;
  const sessionId = payload.sid;

  if (typeof identityId !== "string" || typeof sessionId !== "string") {
    throw new Error("Access token is missing required claims");
  }

  return { identityId, sessionId };
}

export interface GeneratedRefreshToken {
  /** Returned to the client once. Never stored. */
  readonly token: string;
  /** Stored in place of the token. */
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

/** Mint a refresh credential: 256 bits of randomness, plus the hash to keep. */
export function generateRefreshToken(config: AuthConfig, now: Date): GeneratedRefreshToken {
  const token = randomBytes(32).toString("base64url");

  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + config.refreshTokenTtlSeconds * 1000),
  };
}

/**
 * Hash a token for storage and comparison.
 *
 * SHA-256 without a salt is deliberate: these are 256-bit random values, not
 * passwords. There is no dictionary to attack, so the slow hashing that
 * protects human-chosen secrets would only slow down every request.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Compare two hashes without leaking their difference through timing. */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}
