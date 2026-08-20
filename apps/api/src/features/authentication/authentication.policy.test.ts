import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  classifyRefreshFailure,
  endsSession,
  isUsable,
  linkLifetimeMinutes,
  linkUrlFor,
  normalizeEmail,
} from "./authentication.policy.js";
import type { SessionRecord } from "./authentication.types.js";

const NOW = new Date("2026-08-19T12:00:00.000Z");

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  sessionId: "11111111-1111-1111-1111-111111111111",
  identityId: "22222222-2222-2222-2222-222222222222",
  refreshTokenHash: "current",
  refreshGeneration: 0,
  expiresAt: new Date("2026-09-19T12:00:00.000Z"),
  revokedAt: null,
  ...overrides,
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    assert.equal(normalizeEmail("  Person@Example.TEST  "), "person@example.test");
  });

  it("leaves an already-normalised address alone", () => {
    assert.equal(normalizeEmail("person@example.test"), "person@example.test");
  });

  it("keeps dots and plus addressing, which belong to different people", () => {
    assert.equal(normalizeEmail("first.last+tag@example.test"), "first.last+tag@example.test");
  });
});

describe("isUsable", () => {
  it("accepts a session that is neither revoked nor expired", () => {
    assert.equal(isUsable(session(), NOW), true);
  });

  it("refuses a revoked session", () => {
    assert.equal(isUsable(session({ revokedAt: new Date("2026-08-19T11:00:00.000Z") }), NOW), false);
  });

  it("refuses an expired session", () => {
    assert.equal(isUsable(session({ expiresAt: new Date("2026-08-19T11:59:59.999Z") }), NOW), false);
  });

  it("refuses a session expiring exactly now", () => {
    assert.equal(isUsable(session({ expiresAt: NOW }), NOW), false);
  });

  it("accepts a session expiring a millisecond from now", () => {
    assert.equal(isUsable(session({ expiresAt: new Date(NOW.getTime() + 1) }), NOW), true);
  });

  it("refuses a revoked session that has not yet expired", () => {
    assert.equal(
      isUsable(session({ revokedAt: new Date("2026-08-19T11:00:00.000Z") }), NOW),
      false,
      "revocation must not wait for expiry",
    );
  });
});

describe("classifyRefreshFailure", () => {
  it("reports an unknown session", () => {
    assert.equal(classifyRefreshFailure(undefined, "current", NOW), "session_not_found");
  });

  it("reports a revoked session before anything else", () => {
    const revoked = session({
      revokedAt: new Date("2026-08-19T11:00:00.000Z"),
      expiresAt: new Date("2026-08-19T11:00:00.000Z"),
      refreshTokenHash: "something else",
    });

    assert.equal(classifyRefreshFailure(revoked, "current", NOW), "session_revoked");
  });

  it("reports an expired session before a credential mismatch", () => {
    const expired = session({
      expiresAt: new Date("2026-08-19T11:00:00.000Z"),
      refreshTokenHash: "something else",
    });

    assert.equal(classifyRefreshFailure(expired, "current", NOW), "session_expired");
  });

  it("treats expiry at exactly now as expired", () => {
    assert.equal(classifyRefreshFailure(session({ expiresAt: NOW }), "current", NOW), "session_expired");
  });

  it("reports a superseded credential", () => {
    assert.equal(
      classifyRefreshFailure(session({ refreshTokenHash: "rotated" }), "current", NOW),
      "refresh_token_mismatch",
    );
  });

  it("reports a session that never recorded a credential as a mismatch", () => {
    assert.equal(
      classifyRefreshFailure(session({ refreshTokenHash: null }), "current", NOW),
      "refresh_token_mismatch",
    );
  });

  it("reports nothing when the session is in fact refreshable", () => {
    assert.equal(classifyRefreshFailure(session(), "current", NOW), undefined);
  });
});

describe("endsSession", () => {
  it("ends the session when a superseded credential is presented", () => {
    assert.equal(endsSession("refresh_token_mismatch"), true);
  });

  it("leaves the session alone for every other refusal", () => {
    assert.equal(endsSession("session_not_found"), false);
    assert.equal(endsSession("session_revoked"), false);
    assert.equal(endsSession("session_expired"), false);
  });
});

describe("linkUrlFor", () => {
  const base = "https://app.chronologity.test/auth/sessions";

  it("sends a sign-in link to the sign-in path", () => {
    assert.equal(linkUrlFor(base, "login", "abc"), `${base}?token=abc`);
  });

  it("sends a verification link to the verification path", () => {
    assert.equal(
      linkUrlFor(base, "verify_email", "abc"),
      "https://app.chronologity.test/auth/email-verifications?token=abc",
    );
  });

  it("sends a reset link to the reset path", () => {
    assert.equal(
      linkUrlFor(base, "reset_password", "abc"),
      "https://app.chronologity.test/auth/password-resets/complete?token=abc",
    );
  });

  it("hangs the paths off a base that carries no sign-in path", () => {
    assert.equal(
      linkUrlFor("https://app.chronologity.test/auth", "verify_email", "abc"),
      "https://app.chronologity.test/auth/email-verifications?token=abc",
    );
  });

  it("rewrites only the trailing sign-in path", () => {
    assert.equal(
      linkUrlFor("https://sessions.chronologity.test/auth/sessions", "verify_email", "abc"),
      "https://sessions.chronologity.test/auth/email-verifications?token=abc",
      "the host must survive a path rewrite",
    );
  });
});

describe("linkLifetimeMinutes", () => {
  it("reports whole minutes", () => {
    assert.equal(linkLifetimeMinutes(900), 15);
  });

  it("rounds to the nearest minute", () => {
    assert.equal(linkLifetimeMinutes(910), 15);
    assert.equal(linkLifetimeMinutes(950), 16);
  });

  it("never announces zero minutes", () => {
    assert.equal(linkLifetimeMinutes(10), 1, "a link that reads as already dead is worse than wrong");
    assert.equal(linkLifetimeMinutes(0), 1);
  });
});
