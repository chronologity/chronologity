import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideCreateSession,
  decideRefreshSession,
  decideRevokeSession,
  evolveSession,
  initialSessionState,
  isUsable,
  type SessionEvent,
  type SessionState,
} from "./session.aggregate.js";

const sessionId = "11111111-1111-4111-8111-111111111111";
const identityId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-08-15T12:00:00.000Z");
const later = new Date("2026-08-15T12:30:00.000Z");
const expiry = new Date("2026-09-14T12:00:00.000Z");

const replay = (events: readonly SessionEvent[]): SessionState =>
  events.reduce(evolveSession, initialSessionState);

const created = (refreshTokenHash = "hash-1"): SessionEvent => ({
  type: "SessionCreated",
  payload: {
    sessionId,
    identityId,
    refreshTokenHash,
    expiresAt: expiry.toISOString(),
    createdAt: now.toISOString(),
    clientKind: undefined,
  },
});

describe("session state", () => {
  it("starts absent", () => {
    assert.equal(initialSessionState.exists, false);
    assert.equal(isUsable(initialSessionState, now), false);
  });

  it("is usable once created and before expiry", () => {
    assert.equal(isUsable(replay([created()]), now), true);
  });

  it("is not usable after expiry, without needing an expiry event", () => {
    // Expiry is the passage of time. Waiting for an event to record it would
    // leave a session usable simply because nothing had got around to writing
    // the event yet.
    const afterExpiry = new Date(expiry.getTime() + 1000);
    assert.equal(isUsable(replay([created()]), afterExpiry), false);
  });

  it("is not usable once revoked", () => {
    const state = replay([
      created(),
      {
        type: "SessionRevoked",
        payload: { reason: "user_logout", revokedAt: later.toISOString() },
      },
    ]);

    assert.equal(state.status, "revoked");
    assert.equal(isUsable(state, later), false);
  });

  it("tracks the current refresh hash and generation across rotations", () => {
    const state = replay([
      created("hash-1"),
      {
        type: "SessionRefreshed",
        payload: {
          refreshTokenHash: "hash-2",
          refreshGeneration: 1,
          refreshedAt: later.toISOString(),
        },
      },
      {
        type: "SessionRefreshed",
        payload: {
          refreshTokenHash: "hash-3",
          refreshGeneration: 2,
          refreshedAt: later.toISOString(),
        },
      },
    ]);

    assert.equal(state.refreshTokenHash, "hash-3");
    assert.equal(state.refreshGeneration, 2);
  });

  it("ignores event types it does not recognise", () => {
    const state = replay([
      created(),
      { type: "FromTheFuture", payload: {} } as unknown as SessionEvent,
    ]);
    assert.equal(state.status, "active");
  });
});

describe("decideCreateSession", () => {
  it("creates a session", () => {
    const decision = decideCreateSession(initialSessionState, {
      sessionId,
      identityId,
      refreshTokenHash: "hash-1",
      expiresAt: expiry,
      clientKind: "test",
      now,
    });

    assert.equal(decision.ok, true);
    assert.equal(decision.ok && decision.events[0]?.type, "SessionCreated");
  });

  it("refuses to recreate an existing session", () => {
    const decision = decideCreateSession(replay([created()]), {
      sessionId,
      identityId,
      refreshTokenHash: "hash-1",
      expiresAt: expiry,
      clientKind: undefined,
      now,
    });

    assert.equal(decision.ok, false);
    assert.equal(decision.ok === false && decision.reason, "session_already_exists");
  });
});

describe("decideRefreshSession", () => {
  it("rotates the credential when the current one is presented", () => {
    const decision = decideRefreshSession(replay([created("hash-1")]), {
      presentedTokenHash: "hash-1",
      newTokenHash: "hash-2",
      now: later,
    });

    assert.equal(decision.ok, true);

    const event = decision.ok ? decision.events[0] : undefined;
    assert.equal(event?.type, "SessionRefreshed");
    assert.equal(
      event?.type === "SessionRefreshed" ? event.payload.refreshTokenHash : undefined,
      "hash-2",
    );
    assert.equal(
      event?.type === "SessionRefreshed" ? event.payload.refreshGeneration : undefined,
      1,
    );
  });

  it("revokes the whole session when a rotated credential is replayed", () => {
    // The presented credential was valid once. Refusing it while leaving the
    // session alive would let whoever holds it keep trying.
    const state = replay([
      created("hash-1"),
      {
        type: "SessionRefreshed",
        payload: {
          refreshTokenHash: "hash-2",
          refreshGeneration: 1,
          refreshedAt: later.toISOString(),
        },
      },
    ]);

    const decision = decideRefreshSession(state, {
      presentedTokenHash: "hash-1",
      newTokenHash: "hash-3",
      now: later,
    });

    assert.equal(decision.ok, false);
    assert.equal(decision.ok === false && decision.reason, "refresh_token_mismatch");

    const events = decision.ok === false ? (decision.events ?? []) : [];
    assert.equal(events[0]?.type, "SessionRevoked");
    assert.equal(
      events[0]?.type === "SessionRevoked" ? events[0].payload.reason : undefined,
      "refresh_token_reuse",
    );
  });

  it("refuses an unknown session", () => {
    const decision = decideRefreshSession(initialSessionState, {
      presentedTokenHash: "hash-1",
      newTokenHash: "hash-2",
      now,
    });

    assert.equal(decision.ok === false && decision.reason, "session_not_found");
  });

  it("refuses a revoked session", () => {
    const state = replay([
      created(),
      {
        type: "SessionRevoked",
        payload: { reason: "user_logout", revokedAt: later.toISOString() },
      },
    ]);

    const decision = decideRefreshSession(state, {
      presentedTokenHash: "hash-1",
      newTokenHash: "hash-2",
      now: later,
    });

    assert.equal(decision.ok === false && decision.reason, "session_revoked");
  });

  it("refuses an expired session and records the expiry", () => {
    const afterExpiry = new Date(expiry.getTime() + 1000);

    const decision = decideRefreshSession(replay([created()]), {
      presentedTokenHash: "hash-1",
      newTokenHash: "hash-2",
      now: afterExpiry,
    });

    assert.equal(decision.ok === false && decision.reason, "session_expired");
    const events = decision.ok === false ? (decision.events ?? []) : [];
    assert.equal(events[0]?.type, "SessionExpired");
  });
});

describe("decideRevokeSession", () => {
  it("revokes an active session", () => {
    const decision = decideRevokeSession(replay([created()]), {
      reason: "user_logout",
      now: later,
    });

    assert.equal(decision.ok, true);
    assert.equal(decision.ok && decision.events[0]?.type, "SessionRevoked");
  });

  it("is idempotent: revoking twice adds no second fact", () => {
    const state = replay([
      created(),
      {
        type: "SessionRevoked",
        payload: { reason: "user_logout", revokedAt: later.toISOString() },
      },
    ]);

    const decision = decideRevokeSession(state, { reason: "user_logout", now: later });

    assert.equal(decision.ok, true);
    assert.deepEqual(decision.ok ? decision.events : undefined, []);
  });

  it("refuses an unknown session", () => {
    const decision = decideRevokeSession(initialSessionState, { reason: "user_logout", now });
    assert.equal(decision.ok === false && decision.reason, "session_not_found");
  });
});
