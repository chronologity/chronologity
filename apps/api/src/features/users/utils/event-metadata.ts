import type { EventMetadata } from "../../../types/event-metadata.js";
import type { RequestContext } from "../../../types/request-context.js";

/**
 * Metadata recorded alongside every User event.
 *
 * @param context - Supplies the trace identifier and receipt time.
 * @param actorUserId - Who acted. For account creation this is the account
 *   being created: nobody else is acting.
 * @returns Metadata to record with the event.
 */
export function userEventMetadata(
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
