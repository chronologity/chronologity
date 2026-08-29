import { MODERATION_BOUNDARY, MOMENTS_BOUNDARY, USERS_BOUNDARY } from "@chronologity/contracts";
import type { Logger } from "../../lib/logger/logger.js";
import type { ConsumedEvent } from "../../lib/messaging/consumer.js";
import type { TimelineProjector } from "../../features/timeline/timeline.projector.js";

/**
 * Reading one message as a Moment whose place in history may have changed.
 *
 * Every handler yields a Moment identifier and nothing else. The row is built
 * by reading authoritative state, so what a message has to supply is which
 * Moment to go and look at — which is why a payload carrying a caption or an
 * occurrence would be a liability rather than a saving.
 */
const HANDLED: Readonly<Record<string, (payload: Record<string, unknown>) => string | undefined>> =
  {
    MomentRecorded: (payload) => momentId(payload.momentId),
    MomentRevised: (payload) => momentId(payload.momentId),
    MomentVisibilityChanged: (payload) => momentId(payload.momentId),
    MomentRemoved: (payload) => momentId(payload.momentId),
    // A moderation decision about a Moment changes whether it may be shown at
    // all, which is intrinsic to the Moment and therefore lives in the row.
    // Decisions about anything else are not this projection's business: a
    // comment has no place on a Timeline, and an account's suspension is
    // resolved when the Timeline is read rather than written.
    ModerationStateChanged: (payload) =>
      payload.subjectType === "moment" ? momentId(payload.subjectId) : undefined,
    // Not a Moment, and handled separately below. A suspension changes who may
    // see somebody's history without changing any of it, so it writes one row
    // to the suspended-authors table rather than reprojecting a decade.
    UserStatusChanged: () => undefined,
  };

/** The event types this worker knows what to do with. */
export const TIMELINE_PROJECTOR_EVENTS: readonly string[] = Object.keys(HANDLED);

/**
 * The boundaries this worker subscribes to.
 *
 * Two, where the Search indexer takes five. A Timeline row holds only what is
 * intrinsic to a Moment — when it happened, whose it is, whether moderation
 * permits it — so the events that can change one are events about a Moment or
 * about moderating a Moment.
 *
 * It deliberately does not subscribe to `domain-users`. An account being
 * suspended changes who may see somebody's history without changing the history
 * itself, and `search.eligibility.ts` settles where that belongs: the
 * projection carries what is intrinsic, and anything volatile or dependent on
 * who is asking is resolved when the query runs. Projecting it instead would
 * mean rewriting every row somebody ever recorded each time their status
 * changed, and leaving the Timeline wrong until it finished.
 *
 * Declared beside the handlers rather than inside the process entry point, so
 * the two can be compared: `index.ts` runs on import, and a list held there is
 * a list nothing can read.
 */
export const TIMELINE_PROJECTOR_BOUNDARIES: readonly string[] = [
  MOMENTS_BOUNDARY,
  MODERATION_BOUNDARY,
  // For suspension, which decides whether an author's history may be shown in
  // any scope. 7A left this out because a Moment row carries nothing about its
  // author's status; 7C adds it because a Location with a hundred contributors
  // cannot ask PostgreSQL about each of them while paging.
  USERS_BOUNDARY,
];

/**
 * Read an identifier a payload is not trusted to have.
 *
 * @param value - The identifier as the payload carried it, which is `unknown`
 *   because a payload is not this process's to trust.
 * @returns The identifier, or undefined when it is missing or is not a string.
 */
function momentId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Which Moment a message concerns.
 *
 * @param event - The message.
 * @returns The Moment, or undefined when this message does not describe one the
 *   Timeline holds. Unknown types are ignored rather than dead-lettered: a
 *   boundary gains event types over time, and a consumer that fails on the
 *   first one it has not been taught about turns an additive change into an
 *   outage for everything sharing the partition.
 */
export function momentOf(event: ConsumedEvent): string | undefined {
  const read = HANDLED[event.envelope.eventType];

  return read?.(event.envelope.payload as Record<string, unknown>);
}

/**
 * Bring the Timeline up to date with one message.
 *
 * @param projector - Where the work happens.
 * @param event - The message.
 * @param logger - Where lag and skips are reported.
 * @returns Nothing.
 * @throws {Error} If either store refuses. The consumer retries, and a
 *   projection behind is recoverable in a way a projection quietly wrong is
 *   not.
 */
export async function projectFromEvent(
  projector: TimelineProjector,
  event: ConsumedEvent,
  logger?: Logger,
): Promise<void> {
  // Handled before the Moment path, because it names an account rather than a
  // Moment and would otherwise be dropped as unrecognised.
  if (event.envelope.eventType === "UserStatusChanged") {
    const payload = event.envelope.payload as Record<string, unknown>;
    const userId = typeof payload.userId === "string" ? payload.userId : undefined;
    const status = typeof payload.status === "string" ? payload.status : undefined;

    if (userId !== undefined && status !== undefined) {
      await projector.recordStatus(userId, status, new Date(event.envelope.occurredAt));
      logger?.info({ userId, status }, "Recorded an account status change");
    }

    return;
  }

  const moment = momentOf(event);

  if (moment === undefined) {
    logger?.debug(
      { eventType: event.envelope.eventType, eventId: event.envelope.eventId },
      "Nothing to project for this event",
    );

    return;
  }

  const outcome = await projector.handle(event.envelope.eventId, moment);

  // Projection lag is the gap between something happening and the Timeline
  // saying so. Measuring it is what turns an assumption into something
  // observable, as `search.md:519` asks of the indexer for the same reason.
  logger?.info(
    {
      eventType: event.envelope.eventType,
      momentId: moment,
      outcome,
      lagMs: Date.now() - Date.parse(event.envelope.occurredAt),
    },
    "Projected",
  );
}
