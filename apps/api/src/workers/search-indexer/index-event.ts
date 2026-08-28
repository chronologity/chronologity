import {
  LOCATIONS_BOUNDARY,
  MODERATION_BOUNDARY,
  MOMENTS_BOUNDARY,
  REAL_WORLD_EVENTS_BOUNDARY,
  USERS_BOUNDARY,
} from "@chronologity/contracts";
import type { Logger } from "../../lib/logger/logger.js";
import type { ConsumedEvent } from "../../lib/messaging/consumer.js";
import type { SearchIndexer } from "../../features/search/search.indexer.js";
import type { SearchEntityType } from "../../features/search/search-document.js";

/**
 * What a message says changed.
 *
 * The whole of what the indexer needs from a payload: which entity, and of
 * what kind. Everything else about the document is read from authoritative
 * state, which is what lets a message replayed long afterwards produce a
 * current answer rather than resurrecting a stale one.
 */
interface Subject {
  readonly entityType: SearchEntityType;
  readonly entityId: string;
}

/** What moderation calls a subject, and what Search calls the same thing. */
const MODERATION_SUBJECTS: Readonly<Record<string, SearchEntityType | undefined>> = {
  moment: "moment",
  user: "user",
  // A comment is not indexed on its own — `search.md` names no comment document
  // type, and whether a comment match should return the comment or its Moment
  // is still an open question there. A moderated medium reaches Search through
  // the Moment holding it, which the moderation service announces separately.
  comment: undefined,
  media: undefined,
};

/**
 * What this worker understands, and where it reads each one from.
 *
 * A table rather than a switch, because the set of types a worker handles has
 * to be readable by something other than a person. With it written down, a test
 * can check every one against the registry and against what this worker
 * subscribes to — which is how a topic added to the contracts and forgotten
 * here, or subscribed to and never handled, becomes a failing test rather than
 * silence.
 */
const HANDLED: Readonly<
  Record<string, (payload: Record<string, unknown>) => Subject | undefined>
> = {
  MomentRecorded: (payload) => identify("moment", payload.momentId),
  MomentRevised: (payload) => identify("moment", payload.momentId),
  MomentVisibilityChanged: (payload) => identify("moment", payload.momentId),
  MomentRemoved: (payload) => identify("moment", payload.momentId),
  UserCreated: (payload) => identify("user", payload.userId),
  UserProfileChanged: (payload) => identify("user", payload.userId),
  UserStatusChanged: (payload) => identify("user", payload.userId),
  RealWorldEventRecorded: (payload) => identify("event", payload.realWorldEventId),
  RealWorldEventRevised: (payload) => identify("event", payload.realWorldEventId),
  LocationRecorded: (payload) => identify("location", payload.locationId),
  LocationRevised: (payload) => identify("location", payload.locationId),
  ModerationStateChanged: (payload) => {
    const entityType = MODERATION_SUBJECTS[String(payload.subjectType)];

    return entityType === undefined ? undefined : identify(entityType, payload.subjectId);
  },
};

/** The event types this worker knows what to do with. */
export const SEARCH_INDEXER_EVENTS: readonly string[] = Object.keys(HANDLED);

/**
 * The boundaries this worker subscribes to.
 *
 * Declared beside the handlers rather than inside the process entry point, so
 * that the two can be compared. `index.ts` runs on import; a list held there is
 * a list nothing can read.
 *
 * Every domain boundary, because a document is built from several tables and
 * any of them changing can change it.
 */
export const SEARCH_INDEXER_BOUNDARIES: readonly string[] = [
  MOMENTS_BOUNDARY,
  USERS_BOUNDARY,
  REAL_WORLD_EVENTS_BOUNDARY,
  LOCATIONS_BOUNDARY,
  MODERATION_BOUNDARY,
];

/**
 * Read which entity a message concerns.
 *
 * @param event - The message.
 * @returns The subject, or undefined when this message does not describe one
 *   Search indexes. Unknown types are ignored rather than dead-lettered: a
 *   topic gains event types over time, and a consumer that fails on the first
 *   one it has not been taught about turns an additive change into an outage.
 */
export function subjectOf(event: ConsumedEvent): Subject | undefined {
  const read = HANDLED[event.envelope.eventType];

  return read?.(event.envelope.payload as Record<string, unknown>);
}

/**
 * Pair an entity type with an identifier that might not be one.
 *
 * @param entityType - What kind of thing.
 * @param entityId - The identifier as the payload carried it, which is
 *   `unknown` because a payload is not this process's to trust.
 * @returns The subject, or undefined when the identifier is missing or is not
 *   a string.
 */
function identify(entityType: SearchEntityType, entityId: unknown): Subject | undefined {
  return typeof entityId === "string" && entityId.length > 0
    ? { entityType, entityId }
    : undefined;
}

/**
 * Bring the index up to date with one message.
 *
 * Exactly once per message, and idempotent besides: handling the same message
 * twice produces one document, and handling one for an entity that has since
 * gone removes the document rather than failing.
 *
 * A message this consumer does not recognise is acknowledged rather than
 * retried. The alternative is a poison message blocking its partition for
 * every entity that shares it.
 *
 * @param indexer - Where the work happens.
 * @param event - The message.
 * @param logger - Where lag and skips are reported.
 * @returns Nothing.
 */
export async function indexFromEvent(
  indexer: SearchIndexer,
  event: ConsumedEvent,
  logger?: Logger,
): Promise<void> {
  const subject = subjectOf(event);

  if (subject === undefined) {
    logger?.debug(
      { eventType: event.envelope.eventType, eventId: event.envelope.eventId },
      "Nothing to index for this event",
    );

    return;
  }

  const handled = await indexer.handle(
    event.envelope.eventId,
    subject.entityType,
    subject.entityId,
  );

  // Indexing lag is the residual privacy exposure this design accepts: a
  // restriction is only enforced in Search once its message arrives. Measuring
  // it is what turns that from an assumption into something observable, which
  // `search.md:519` asks for by name.
  logger?.info(
    {
      eventType: event.envelope.eventType,
      entityType: subject.entityType,
      entityId: subject.entityId,
      handled,
      lagMs: Date.now() - Date.parse(event.envelope.occurredAt),
    },
    handled ? "Indexed" : "Already indexed",
  );
}
