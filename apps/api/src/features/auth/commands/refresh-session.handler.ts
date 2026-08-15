import type { SessionCredentials } from "@chronologity/contracts";
import { recordAuthAudit } from "../../../lib/auth/audit.js";
import { generateRefreshToken, hashToken, issueAccessToken } from "../../../lib/auth/tokens.js";
import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import { UnauthenticatedError } from "../../../lib/errors/unauthorized-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import { decideRefreshSession, SESSION_CATEGORY } from "../aggregates/session.aggregate.js";
import { clockFor, type AuthDependencies } from "../dependencies.js";
import { authEventMetadata } from "../utils/event-metadata.js";
import { toSessionCredentials } from "../utils/issue-credentials.js";
import { recordSessionRefreshed, recordSessionRevoked } from "../utils/session-read-model.js";
import { findUserIdForIdentity } from "../../users/utils/user-read-model.js";
import { loadSession } from "../utils/session-store.js";
import type { RefreshSessionCommand } from "./refresh-session.command.js";

/**
 * Rotate a Session's refresh credential.
 *
 * A presented credential that is not the current one means an already-rotated
 * credential is in circulation, and the aggregate responds by revoking the
 * Session rather than merely refusing the request. The events that decision
 * produces are persisted even though the operation fails, because the
 * revocation is a fact regardless of what the caller is told.
 *
 * @param deps - Event store, database, configuration, and clock.
 * @param command - Which Session, and the credential presented.
 * @param context - Trace identifier and receipt time.
 * @returns A fresh credential pair.
 * @throws {UnauthenticatedError} If the Session is unknown, revoked, expired, or
 *   the credential is not the current one. The last case also revokes the
 *   Session, and those events are persisted even though the call fails.
 */
export async function handleRefreshSession(
  deps: AuthDependencies,
  command: RefreshSessionCommand,
  context: RequestContext,
): Promise<SessionCredentials> {
  const at = clockFor(deps)();
  const { sessionId, refreshToken } = command.payload;

  const { state, revision } = await loadSession(deps, sessionId);
  const replacement = generateRefreshToken(deps.config, at);

  const decision = decideRefreshSession(state, {
    presentedTokenHash: hashToken(refreshToken),
    newTokenHash: replacement.tokenHash,
    now: at,
  });

  const events = decision.ok ? decision.events : (decision.events ?? []);

  if (events.length > 0) {
    await appendEvents({
      client: deps.client,
      streamName: streamName(SESSION_CATEGORY, sessionId),
      events,
      metadata: authEventMetadata(context, state.identityId),
      expectedRevision: revision,
    });
  }

  if (!decision.ok) {
    await withTransaction(deps.pool, async (tx) => {
      if (decision.reason === "refresh_token_mismatch") {
        await recordSessionRevoked(tx, sessionId, "refresh_token_reuse", at);
      }

      await recordAuthAudit(tx, {
        eventType: "session_refresh_rejected",
        outcome: "failure",
        identityId: state.identityId,
        sessionId,
        reason: decision.reason,
        traceId: context.traceId,
      });
    });

    throw new UnauthenticatedError("Session could not be refreshed");
  }

  const identityId = state.identityId;

  if (identityId === undefined) {
    throw new UnauthenticatedError("Session could not be refreshed");
  }

  // Re-resolved on refresh, which is how a token catches up after account
  // creation.
  const userId = await findUserIdForIdentity(deps.pool, identityId);
  const access = await issueAccessToken(deps.config, { identityId, sessionId, userId }, at);

  await withTransaction(deps.pool, async (tx) => {
    await recordSessionRefreshed(tx, sessionId, at);
    await recordAuthAudit(tx, {
      eventType: "session_refreshed",
      outcome: "success",
      identityId,
      sessionId,
      traceId: context.traceId,
    });
  });

  return toSessionCredentials({
    sessionId,
    access,
    refreshToken: replacement.token,
    refreshTokenExpiresAt: replacement.expiresAt,
  });
}
