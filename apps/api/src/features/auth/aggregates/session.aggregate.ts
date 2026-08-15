import type { SessionCreated } from "../events/session-created.event.js";
import type { SessionExpired } from "../events/session-expired.event.js";
import type { SessionRefreshed } from "../events/session-refreshed.event.js";
import type { SessionRevoked } from "../events/session-revoked.event.js";

/**
 * Session — a bounded authenticated login context.
 *
 * The Session, not the token, is the authoritative revocation boundary. An
 * access token is a short-lived representation of a Session; revoking the
 * Session ends every credential derived from it, which is what makes "log out
 * everywhere" mean something.
 *
 * Only the SHA-256 hash of the current refresh credential is recorded. The
 * credential itself is returned to the client once and never stored, so
 * possession of the history does not confer the ability to refresh.
 */

export const SESSION_CATEGORY = "session";

export type SessionStatus = "active" | "revoked" | "expired";

export interface SessionState {
  readonly exists: boolean;
  readonly sessionId: string | undefined;
  readonly identityId: string | undefined;
  readonly status: SessionStatus;
  /** Hash of the refresh credential currently valid for this Session. */
  readonly refreshTokenHash: string | undefined;
  /** Increments on every rotation. Present so reuse is legible in history. */
  readonly refreshGeneration: number;
  readonly expiresAt: string | undefined;
  readonly createdAt: string | undefined;
  readonly revocationReason: string | undefined;
}

/** Everything that can happen to a Session. */
export type SessionEvent = SessionCreated | SessionRefreshed | SessionRevoked | SessionExpired;

export const initialSessionState: SessionState = {
  exists: false,
  sessionId: undefined,
  identityId: undefined,
  status: "active",
  refreshTokenHash: undefined,
  refreshGeneration: 0,
  expiresAt: undefined,
  createdAt: undefined,
  revocationReason: undefined,
};

/** Rebuild Session state from its history. Pure, so replay is deterministic. */
export function evolveSession(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case "SessionCreated":
      return {
        ...state,
        exists: true,
        sessionId: event.payload.sessionId,
        identityId: event.payload.identityId,
        status: "active",
        refreshTokenHash: event.payload.refreshTokenHash,
        refreshGeneration: 0,
        expiresAt: event.payload.expiresAt,
        createdAt: event.payload.createdAt,
      };

    case "SessionRefreshed":
      return {
        ...state,
        refreshTokenHash: event.payload.refreshTokenHash,
        refreshGeneration: event.payload.refreshGeneration,
      };

    case "SessionRevoked":
      return { ...state, status: "revoked", revocationReason: event.payload.reason };

    case "SessionExpired":
      return { ...state, status: "expired" };

    default:
      return state;
  }
}

/**
 * Whether a Session may authenticate a request right now.
 *
 * Expiry is evaluated against the clock rather than waiting for an
 * `SessionExpired` event, because nothing guarantees that event has been
 * written yet — expiry is the passage of time, not an action anyone takes.
 */
export function isUsable(state: SessionState, now: Date): boolean {
  if (!state.exists || state.status !== "active") {
    return false;
  }

  return state.expiresAt !== undefined && Date.parse(state.expiresAt) > now.getTime();
}

export type SessionRejection =
  | "session_not_found"
  | "session_already_exists"
  | "session_revoked"
  | "session_expired"
  | "refresh_token_mismatch";

export type SessionDecision =
  | { readonly ok: true; readonly events: readonly SessionEvent[] }
  | {
      readonly ok: false;
      readonly reason: SessionRejection;
      /** Events to persist even though the operation failed. */
      readonly events?: readonly SessionEvent[];
    };

export function decideCreateSession(
  state: SessionState,
  input: {
    sessionId: string;
    identityId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    clientKind: string | undefined;
    now: Date;
  },
): SessionDecision {
  if (state.exists) {
    return { ok: false, reason: "session_already_exists" };
  }

  return {
    ok: true,
    events: [
      {
        type: "SessionCreated",
        payload: {
          sessionId: input.sessionId,
          identityId: input.identityId,
          refreshTokenHash: input.refreshTokenHash,
          expiresAt: input.expiresAt.toISOString(),
          createdAt: input.now.toISOString(),
          clientKind: input.clientKind,
        },
      },
    ],
  };
}

/**
 * Rotate the refresh credential.
 *
 * Presenting a credential that is not the current one means an already-rotated
 * credential is in circulation. Either it leaked, or a legitimate client is
 * replaying an old one — and the two are indistinguishable from here. The
 * Session is revoked rather than merely refused, because refusing a stolen
 * credential while leaving the session alive lets the thief keep using the one
 * they hold. Revocation is the response `authentication.md:490` leaves to be
 * defined; this defines it.
 */
export function decideRefreshSession(
  state: SessionState,
  input: { presentedTokenHash: string; newTokenHash: string; now: Date },
): SessionDecision {
  if (!state.exists) {
    return { ok: false, reason: "session_not_found" };
  }

  if (state.status === "revoked") {
    return { ok: false, reason: "session_revoked" };
  }

  if (!isUsable(state, input.now)) {
    return {
      ok: false,
      reason: "session_expired",
      events: [{ type: "SessionExpired", payload: { expiredAt: input.now.toISOString() } }],
    };
  }

  if (state.refreshTokenHash !== input.presentedTokenHash) {
    return {
      ok: false,
      reason: "refresh_token_mismatch",
      events: [
        {
          type: "SessionRevoked",
          payload: { reason: "refresh_token_reuse", revokedAt: input.now.toISOString() },
        },
      ],
    };
  }

  return {
    ok: true,
    events: [
      {
        type: "SessionRefreshed",
        payload: {
          refreshTokenHash: input.newTokenHash,
          refreshGeneration: state.refreshGeneration + 1,
          refreshedAt: input.now.toISOString(),
        },
      },
    ],
  };
}

/**
 * End a Session.
 *
 * Revoking an already-revoked Session succeeds without a further event: the
 * caller's intent is satisfied, and logging out twice is not an error worth
 * showing anyone.
 */
export function decideRevokeSession(
  state: SessionState,
  input: { reason: string; now: Date },
): SessionDecision {
  if (!state.exists) {
    return { ok: false, reason: "session_not_found" };
  }

  if (state.status === "revoked") {
    return { ok: true, events: [] };
  }

  return {
    ok: true,
    events: [
      {
        type: "SessionRevoked",
        payload: { reason: input.reason, revokedAt: input.now.toISOString() },
      },
    ],
  };
}
