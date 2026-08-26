import type { Logger } from "../../lib/logger/logger.js";
import type { ConsumedEvent } from "../../lib/messaging/consumer.js";
import type { Candidate, NotificationGenerator } from "../../features/notifications/notification.generator.js";

/**
 * Reading one message as something somebody should hear about.
 *
 * Every case names the recipient explicitly rather than deriving one. A rule
 * like "notify the author" reads well until an event arrives where the author
 * is the actor, and the mistake it makes is telling somebody about their own
 * activity — which is the kind of bug people notice immediately and trust
 * slowly afterwards.
 *
 * @param event - The message.
 * @returns What to consider, or undefined when this message is not something to
 *   tell anybody about. Undefined for an event type this does not recognise:
 *   topics gain types over time, and a consumer that fails on the first one it
 *   has not been taught about turns an additive change into an outage for
 *   everything sharing the partition.
 */
export function candidateFrom(event: ConsumedEvent): Candidate | undefined {
  const payload = event.envelope.payload as Record<string, unknown>;
  const text = (key: string): string | undefined =>
    typeof payload[key] === "string" && (payload[key] as string).length > 0
      ? (payload[key] as string)
      : undefined;

  switch (event.envelope.eventType) {
    case "MomentReacted":
      return build("moment_reacted", text("actorUserId"), text("authorUserId"), "moment", text("momentId"), text("momentId"));
    case "CommentReacted":
      return build("comment_reacted", text("actorUserId"), text("authorUserId"), "comment", text("commentId"), text("momentId"));
    case "MomentCommented":
      return build("moment_commented", text("actorUserId"), text("momentAuthorUserId"), "moment", text("momentId"), text("momentId"));
    case "CommentReplied":
      return build("comment_replied", text("actorUserId"), text("inReplyToAuthorUserId"), "comment", text("inReplyToCommentId"), text("momentId"));
    case "CommentMentioned":
      return build("comment_mentioned", text("actorUserId"), text("mentionedUserId"), "comment", text("commentId"), text("momentId"));
    case "UserFollowed":
      return build("user_followed", text("actorUserId"), text("followedUserId"), "user", text("actorUserId"), undefined);
    case "FollowRequested":
      return build("follow_requested", text("actorUserId"), text("followedUserId"), "user", text("actorUserId"), undefined);
    case "FollowRequestAccepted":
      return build("follow_request_accepted", text("actorUserId"), text("requesterUserId"), "user", text("actorUserId"), undefined);
    case "ModerationStateChanged": {
      // Only content states reach somebody. A suspension is announced through
      // the account itself, and 5N already tells people what was done to them
      // through their moderation history.
      if (payload.subjectType !== "moment" && payload.subjectType !== "comment") {
        return undefined;
      }

      const affected = text("affectedUserId");
      const subject = text("subjectId");

      // No actor. The affected person is told what happened to their content
      // and never which moderator decided it.
      return affected === undefined || subject === undefined
        ? undefined
        : {
            type: "content_moderated",
            actorUserId: undefined,
            subjectUserId: affected,
            sourceType: payload.subjectType,
            sourceId: subject,
            viaMomentId: undefined,
          };
    }
    default:
      return undefined;
  }
}

/**
 * Assemble a candidate, refusing one with a piece missing.
 *
 * @param type - What happened.
 * @param actorUserId - Who did it.
 * @param subjectUserId - Who it happened to.
 * @param sourceType - What kind of thing it concerns.
 * @param sourceId - Which one.
 * @param viaMomentId - The Moment whose visibility decides whether the
 *   recipient may know, where there is one.
 * @returns The candidate, or undefined when any identifier is missing — a
 *   payload is not this process's to trust, and a notification with a hole in
 *   it is worse than none.
 */
function build(
  type: string,
  actorUserId: string | undefined,
  subjectUserId: string | undefined,
  sourceType: Candidate["sourceType"],
  sourceId: string | undefined,
  viaMomentId: string | undefined,
): Candidate | undefined {
  if (actorUserId === undefined || subjectUserId === undefined || sourceId === undefined) {
    return undefined;
  }

  return { type, actorUserId, subjectUserId, sourceType, sourceId, viaMomentId };
}

/**
 * Handle one message.
 *
 * @param generator - Where the decisions are made.
 * @param event - The message.
 * @param logger - Where outcomes are reported.
 * @returns Nothing. A message that produces no notification is acknowledged
 *   rather than retried: not everything that happens is something to tell
 *   somebody about, and a consumer that retried those would never drain.
 */
export async function notifyFromEvent(
  generator: NotificationGenerator,
  event: ConsumedEvent,
  logger?: Logger,
): Promise<void> {
  const candidate = candidateFrom(event);

  if (candidate === undefined) {
    logger?.debug(
      { eventType: event.envelope.eventType, eventId: event.envelope.eventId },
      "Nothing to notify anybody about",
    );

    return;
  }

  const outcome = await generator.consider(candidate, event.envelope.eventId);

  logger?.info(
    {
      eventType: event.envelope.eventType,
      eventId: event.envelope.eventId,
      type: candidate.type,
      outcome,
      lagMs: Date.now() - Date.parse(event.envelope.occurredAt),
    },
    "Considered",
  );
}
