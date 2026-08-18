import type { EventMetadata } from "../../../types/event-metadata.js";
import type { RequestContext } from "../../../types/request-context.js";

/**
 * Metadata recorded alongside every Upload event.
 *
 * @param context - Supplies the trace identifier and receipt time.
 * @param actorUserId - Who acted. Always the Upload's owner in this sub-phase;
 *   the media worker acts without a User when it arrives in 5E-2.
 * @returns Metadata to record with the event.
 */
export function uploadEventMetadata(
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
