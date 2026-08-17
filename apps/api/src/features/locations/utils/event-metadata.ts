import type { EventMetadata } from "../../../types/domain-event.js";
import type { RequestContext } from "../../../types/request-context.js";

/**
 * Metadata recorded alongside every Location event.
 *
 * @param context - Supplies the trace identifier and receipt time.
 * @param actorUserId - Who recorded the place.
 * @returns Metadata to record with the event.
 */
export function locationEventMetadata(
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
