import type { EventMetadata } from "../../../types/event-metadata.js";
import type { RequestContext } from "../../../types/request-context.js";

/**
 * Metadata recorded alongside every authorization event.
 *
 * @param context - Supplies the trace identifier and receipt time.
 * @param actorUserId - Who acted. Undefined for a change made through the CLI,
 *   where authority came from infrastructure access rather than from a User.
 * @returns Metadata to record with the event.
 */
export function authorizationEventMetadata(
  context: RequestContext,
  actorUserId: string | undefined,
): EventMetadata {
  return {
    traceId: context.traceId,
    correlationId: context.traceId,
    causationId: undefined,
    actorUserId,
    eventVersion: 1,
    recordedAt: context.receivedAt.toISOString(),
  };
}
