import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthConfig } from "../../config/auth-config.js";
import {
  generateRefreshToken,
  hashesMatch,
  hashToken,
  issueAccessToken,
  verifyAccessToken,
} from "./tokens.js";

const config: AuthConfig = {
  jwtSecret: new TextEncoder().encode("a-test-secret-that-is-long-enough-for-hs256"),
  issuer: "chronologity",
  audience: "chronologity-clients",
  accessTokenTtlSeconds: 600,
  refreshTokenTtlSeconds: 2_592_000,
  magicLinkTtlSeconds: 900,
  magicLinkBaseUrl: "http://localhost:3000/auth/sessions",
};

const claims = {
  identityId: "44444444-4444-4444-8444-444444444444",
  sessionId: "55555555-5555-4555-8555-555555555555",
};

/**
 * Verification checks `exp` against the real clock, so tokens under test must
 * be issued relative to now. A fixed issue time makes these tests pass until
 * the wall clock overtakes it and then fail forever after.
 */
const now = new Date();

/** Fixed instant, for assertions about arithmetic rather than validity. */
const fixed = new Date("2026-08-15T12:00:00.000Z");

describe("access tokens", () => {
  it("round-trips its claims", async () => {
    const issued = await issueAccessToken(config, claims, now);
    const verified = await verifyAccessToken(config, issued.token);

    assert.deepEqual(verified, claims);
  });

  it("expires after the configured lifetime", async () => {
    const issued = await issueAccessToken(config, claims, fixed);

    assert.equal(issued.expiresAt.getTime() - fixed.getTime(), 600_000);
  });

  it("rejects a token signed with a different secret", async () => {
    const issued = await issueAccessToken(config, claims, now);
    const other = {
      ...config,
      jwtSecret: new TextEncoder().encode("a-completely-different-secret-value"),
    };

    await assert.rejects(() => verifyAccessToken(other, issued.token));
  });

  it("rejects a token issued for a different audience", async () => {
    const issued = await issueAccessToken({ ...config, audience: "someone-else" }, claims, now);

    await assert.rejects(() => verifyAccessToken(config, issued.token));
  });

  it("rejects a token issued by a different issuer", async () => {
    const issued = await issueAccessToken({ ...config, issuer: "not-chronologity" }, claims, now);

    await assert.rejects(() => verifyAccessToken(config, issued.token));
  });

  it("rejects a tampered token", async () => {
    const issued = await issueAccessToken(config, claims, now);
    const [header, , signature] = issued.token.split(".");
    const forged = `${header}.${Buffer.from('{"sub":"attacker","sid":"attacker"}').toString("base64url")}.${signature}`;

    await assert.rejects(() => verifyAccessToken(config, forged));
  });

  it("rejects an expired token", async () => {
    const issued = await issueAccessToken(
      { ...config, accessTokenTtlSeconds: 1 },
      claims,
      new Date(Date.now() - 60_000),
    );

    await assert.rejects(() => verifyAccessToken(config, issued.token));
  });

  it("rejects a malformed token", async () => {
    await assert.rejects(() => verifyAccessToken(config, "not-a-token"));
  });

  it("carries no authorization state", async () => {
    // Roles change faster than a token's lifetime, and a token asserting them
    // cannot be corrected until it expires.
    const issued = await issueAccessToken(config, claims, now);
    const payload = JSON.parse(
      Buffer.from(issued.token.split(".")[1] ?? "", "base64url").toString("utf8"),
    );

    assert.deepEqual(Object.keys(payload).sort(), ["aud", "exp", "iat", "iss", "sid", "sub"]);
  });
});

describe("refresh tokens", () => {
  it("returns a token alongside the hash that will be stored", () => {
    const refresh = generateRefreshToken(config, now);

    assert.equal(refresh.tokenHash, hashToken(refresh.token));
    assert.notEqual(refresh.token, refresh.tokenHash);
  });

  it("is unguessable: no two tokens repeat", () => {
    const tokens = new Set(
      Array.from({ length: 500 }, () => generateRefreshToken(config, now).token),
    );

    assert.equal(tokens.size, 500);
  });

  it("expires after the configured lifetime", () => {
    const refresh = generateRefreshToken(config, fixed);

    assert.equal(refresh.expiresAt.getTime() - fixed.getTime(), 2_592_000_000);
  });
});

describe("hashing", () => {
  it("is deterministic", () => {
    assert.equal(hashToken("value"), hashToken("value"));
  });

  it("differs for different inputs", () => {
    assert.notEqual(hashToken("value"), hashToken("value "));
  });

  it("matches equal hashes and rejects unequal ones", () => {
    assert.equal(hashesMatch(hashToken("a"), hashToken("a")), true);
    assert.equal(hashesMatch(hashToken("a"), hashToken("b")), false);
  });

  it("rejects inputs of differing length without throwing", () => {
    assert.equal(hashesMatch("short", hashToken("a")), false);
  });
});
