import { recordAuthAudit } from "../../../lib/auth/audit.js";
import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import { UnauthenticatedError } from "../../../lib/errors/unauthorized-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import { decideRevokeSession, SESSION_CATEGORY } from "../aggregates/session.aggregate.js";
import { clockFor, type AuthDependencies } from "../dependencies.js";
import { authEventMetadata } from "../utils/event-metadata.js";
import { recordSessionRevoked } from "../utils/session-read-model.js";
import { loadSession } from "../utils/session-store.js";
import type { RevokeSessionCommand } from "./revoke-session.command.js";

/**
 * End a Session.
 *
 * A Session belonging to someone else is refused exactly as one that does not
 * exist, so this cannot be used to discover which session identifiers are real.
 *
 * @param deps - Event store, database, and clock.
 * @param command - Which Session, who is asking, and why.
 * @param context - Trace identifier and receipt time.
 * @returns Nothing.
 * @throws {UnauthenticatedError} If the Session does not exist or belongs to
 *   someone else — reported identically, so this cannot be used to discover which
 *   session identifiers are real.
 */
export async function handleRevokeSession(
  deps: AuthDependencies,
  command: RevokeSessionCommand,
  context: RequestContext,
): Promise<void> {
  const at = clockFor(deps)();
  const { sessionId, identityId, reason } = command.payload;

  const { state, revision } = await loadSession(deps, sessionId);

  if (!state.exists || state.identityId !== identityId) {
    throw new UnauthenticatedError("Session could not be revoked");
  }

  const decision = decideRevokeSession(state, { reason, now: at });

  if (!decision.ok) {
    throw new UnauthenticatedError("Session could not be revoked");
  }

  if (decision.events.length > 0) {
    await appendEvents({
      client: deps.client,
      streamName: streamName(SESSION_CATEGORY, sessionId),
      events: decision.events,
      metadata: authEventMetadata(context, identityId),
      expectedRevision: revision,
    });
  }

  await withTransaction(deps.pool, async (tx) => {
    await recordSessionRevoked(tx, sessionId, reason, at);
    await recordAuthAudit(tx, {
      eventType: "session_revoked",
      outcome: "success",
      identityId,
      sessionId,
      reason,
      traceId: context.traceId,
    });
  });
}
