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
 * Read which entity a message concerns.
 *
 * @param event - The message.
 * @returns The subject, or undefined when this message does not describe one
 *   Search indexes. Unknown types are ignored rather than dead-lettered: a
 *   topic gains event types over time, and a consumer that fails on the first
 *   one it has not been taught about turns an additive change into an outage.
 */
export function subjectOf(event: ConsumedEvent): Subject | undefined {
  const payload = event.envelope.payload as Record<string, unknown>;

  switch (event.envelope.eventType) {
    case "MomentRecorded":
    case "MomentRevised":
    case "MomentVisibilityChanged":
    case "MomentRemoved":
      return identify("moment", payload.momentId);
    case "UserCreated":
    case "UserProfileChanged":
    case "UserStatusChanged":
      return identify("user", payload.userId);
    case "RealWorldEventRecorded":
    case "RealWorldEventRevised":
      return identify("event", payload.realWorldEventId);
    case "LocationRecorded":
    case "LocationRevised":
      return identify("location", payload.locationId);
    case "ModerationStateChanged": {
      const entityType = MODERATION_SUBJECTS[String(payload.subjectType)];

      return entityType === undefined ? undefined : identify(entityType, payload.subjectId);
    }
    default:
      return undefined;
  }
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
