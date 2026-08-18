import type { EventMetadata } from "../../../types/event-metadata.js";
import type { RequestContext } from "../../../types/request-context.js";

/**
 * Metadata recorded alongside every authentication event.
 *
 * The trace identifier becomes the correlation identifier so that a session
 * created during a request can still be tied to that request months later,
 * when the logs are gone and only the event history remains.
 *
 * @param context - Supplies the trace identifier and receipt time.
 * @param actorIdentityId - Who acted, when known.
 * @returns Metadata to record alongside the event. The trace identifier becomes
 *   the correlation identifier, so a Session created during a request can still
 *   be tied to it months later, when the logs are gone and only history remains.
 */
export function authEventMetadata(
  context: RequestContext,
  actorIdentityId?: string | undefined,
): EventMetadata {
  return {
    traceId: context.traceId,
    correlationId: context.traceId,
    causationId: undefined,
    actorUserId: actorIdentityId,
    eventVersion: 1,
    recordedAt: context.receivedAt.toISOString(),
  };
}
