import {
  COMMENTS_BOUNDARY,
  MODERATION_BOUNDARY,
  MOMENTS_BOUNDARY,
  REACTIONS_BOUNDARY,
  SECURITY_BOUNDARY,
  SOCIAL_BOUNDARY,
  PARTICIPATION_BOUNDARY,
} from "@chronologity/contracts";
import type { Logger } from "../../lib/logger/logger.js";
import type { ConsumedEvent } from "../../lib/messaging/consumer.js";
import type { Candidate, NotificationGenerator } from "../../features/notifications/notification.generator.js";

/**
 * What this worker understands, and whom each one concerns.
 *
 * A table rather than a switch, because the set of types a worker handles has
 * to be readable by something other than a person. Written down, it can be
 * checked against the registry and against what this worker subscribes to — so
 * an event added to a boundary and never handled here, or handled here and
 * never subscribed to, is a failing test rather than a notification nobody
 * receives.
 *
 * Every entry names the recipient explicitly rather than deriving one. A rule
 * like "notify the author" reads well until an event arrives where the author
 * is the actor, and the mistake it makes is telling somebody about their own
 * activity — which is the kind of bug people notice immediately and trust
 * slowly afterwards.
 */
const HANDLED: Readonly<
  Record<string, (read: (key: string) => string | undefined, payload: Record<string, unknown>) => Candidate | undefined>
> = {
  MomentReacted: (text) =>
    build("moment_reacted", text("actorUserId"), text("authorUserId"), "moment", text("momentId"), text("momentId")),
  CommentReacted: (text) =>
    build("comment_reacted", text("actorUserId"), text("authorUserId"), "comment", text("commentId"), text("momentId")),
  MomentCommented: (text) =>
    build("moment_commented", text("actorUserId"), text("momentAuthorUserId"), "moment", text("momentId"), text("momentId")),
  CommentReplied: (text) =>
    build("comment_replied", text("actorUserId"), text("inReplyToAuthorUserId"), "comment", text("inReplyToCommentId"), text("momentId")),
  CommentMentioned: (text) =>
    build("comment_mentioned", text("actorUserId"), text("mentionedUserId"), "comment", text("commentId"), text("momentId")),
  UserFollowed: (text) =>
    build("user_followed", text("actorUserId"), text("followedUserId"), "user", text("actorUserId"), undefined),
  FollowRequested: (text) =>
    build("follow_requested", text("actorUserId"), text("followedUserId"), "user", text("actorUserId"), undefined),
  FollowRequestAccepted: (text) =>
    build("follow_request_accepted", text("actorUserId"), text("requesterUserId"), "user", text("actorUserId"), undefined),
  // The source is the participation, never the Moment, and there is no
  // `viaMomentId`. Both matter: a notification sourced from a Moment has its
  // visibility re-checked when it is read, and the person being asked to
  // confirm they were somewhere frequently cannot read it — so this would be
  // written and then never render for the one person who has to see it. The
  // participation is also unique per notification, so a second proposal is not
  // folded into an unread first.
  ParticipationProposed: (text) =>
    build("participation_proposed", text("proposedByUserId"), text("userId"), "participation", text("participationId"), undefined),
  // The three answers go to the creator, who is the Moment's author.
  ParticipationAccepted: (text) =>
    build("participation_accepted", text("userId"), text("proposedByUserId"), "participation", text("participationId"), undefined),
  ParticipationRejected: (text) =>
    build("participation_rejected", text("userId"), text("proposedByUserId"), "participation", text("participationId"), undefined),
  ParticipationWithdrawn: (text) =>
    build("participation_withdrawn", text("userId"), text("proposedByUserId"), "participation", text("participationId"), undefined),
  AccountSecurityChanged: (text) => {
    // The recipient is the account itself. There is no actor: whoever
    // performed the change is exactly what this system cannot know during a
    // takeover, and naming the account as its own actor would assert
    // something untrue at the one moment it matters.
    const userId = text("userId");
    const change = text("change");

    // Null during registration, which happens before a User exists. Nobody to
    // tell, which is an ordinary outcome rather than a failure.
    return userId === undefined || change === undefined
      ? undefined
      : {
          type: change,
          actorUserId: undefined,
          subjectUserId: userId,
          sourceType: "user",
          sourceId: userId,
          viaMomentId: undefined,
        };
  },
  ModerationStateChanged: (text, payload) => {
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
  },
};

/**
 * The event types this worker knows what to do with.
 *
 * The candidate map, plus the one message that does not go through it.
 * `MomentRecorded` concerns however many people follow the places it arrived at
 * rather than one person, so it takes the fan-out path — but it is handled, and
 * a list that omitted it would say this worker subscribes to a boundary it
 * ignores.
 */
export const NOTIFICATION_GENERATOR_EVENTS: readonly string[] = [
  ...Object.keys(HANDLED),
  "MomentRecorded",
];

/**
 * The boundaries this worker subscribes to.
 *
 * Declared beside the handlers rather than inside the process entry point, so
 * that the two can be compared. `index.ts` runs on import; a list held there is
 * a list nothing can read.
 */
export const NOTIFICATION_GENERATOR_BOUNDARIES: readonly string[] = [
  // Moments, for the fan-out: a Moment arriving at a followed place is the only
  // thing here that concerns people other than the two in the interaction.
  MOMENTS_BOUNDARY,
  REACTIONS_BOUNDARY,
  COMMENTS_BOUNDARY,
  SOCIAL_BOUNDARY,
  PARTICIPATION_BOUNDARY,
  MODERATION_BOUNDARY,
  SECURITY_BOUNDARY,
];

/**
 * Read one message as something somebody should hear about.
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

  return HANDLED[event.envelope.eventType]?.(text, payload);
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
 * @param contexts - Optional. Where to read a Moment's places and who follows
 *   them, for the one message that concerns many people rather than one. Absent
 *   in an application without following, where nothing fans out.
 * @returns Nothing. A message that produces no notification is acknowledged
 *   rather than retried: not everything that happens is something to tell
 *   somebody about, and a consumer that retried those would never drain.
 */
export async function notifyFromEvent(
  generator: NotificationGenerator,
  event: ConsumedEvent,
  logger?: Logger,
  contexts?: ContextFanOut,
): Promise<void> {
  // A Moment arriving somewhere is the one message that concerns many people
  // rather than one, so it takes its own path.
  if (event.envelope.eventType === "MomentRecorded" && contexts !== undefined) {
    await tellFollowersOfItsPlaces(generator, event, contexts, logger);

    return;
  }

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


/**
 * How many followers of one place are told at a time.
 *
 * A well-known Location could be followed by everybody. Reading the whole list
 * to notify it would hold that list for as long as the notifying took, so the
 * fan-out walks instead.
 */
const FOLLOWERS_PER_PAGE = 200;

/** What the fan-out needs in order to find who to tell. */
export interface ContextFanOut {
  /** The places and occasions a Moment belongs to. */
  contextsOf(momentId: string): Promise<readonly { type: string; id: string }[]>;
  /** A page of the people following one of them. */
  followersOf(
    context: { type: "location"; id: string } | { type: "real_world_event"; id: string },
    limit: number,
    after?: string,
  ): Promise<string[]>;
}

/**
 * Tell everybody following a place that history there has grown.
 *
 * The one place this system fans a single message out to many recipients.
 *
 * **Idempotent per recipient, with no bookkeeping of its own.** Every
 * notification it raises carries the message's own event identifier, and the
 * ledger is keyed on `(source_event_id, recipient_user_id)` — so a redelivery,
 * or a crash halfway through a large place, re-runs the whole fan-out and
 * silently skips whoever was already told.
 *
 * **Whether a follower may know is decided per follower**, by the same Moment
 * visibility rule everything else uses: `consider` re-checks it before writing,
 * so a Moment recorded privately at a public place tells nobody.
 *
 * @param generator - Decides, per recipient, whether to write anything.
 * @param event - The message saying a Moment was recorded.
 * @param contexts - Where to read the Moment's places and their followers.
 * @param logger - Optional.
 * @returns Nothing.
 * @throws {Error} If either read fails. The message is then retried, which is
 *   safe for exactly the reason above.
 */
async function tellFollowersOfItsPlaces(
  generator: NotificationGenerator,
  event: ConsumedEvent,
  contexts: ContextFanOut,
  logger?: Logger,
): Promise<void> {
  const payload = event.envelope.payload as { momentId?: string; authorUserId?: string };
  const momentId = payload.momentId;

  if (momentId === undefined) {
    return;
  }

  let told = 0;

  for (const context of await contexts.contextsOf(momentId)) {
    if (context.type !== "location" && context.type !== "real_world_event") {
      continue;
    }

    const scope =
      context.type === "location"
        ? ({ type: "location", id: context.id } as const)
        : ({ type: "real_world_event", id: context.id } as const);

    let after: string | undefined;

    for (;;) {
      const followers = await contexts.followersOf(scope, FOLLOWERS_PER_PAGE, after);

      if (followers.length === 0) {
        break;
      }

      for (const followerUserId of followers) {
        // The author knows. Telling them their own Moment arrived somewhere
        // would be the system reporting its own work back to them.
        if (followerUserId === payload.authorUserId) {
          continue;
        }

        const outcome = await generator.consider(
          {
            type: context.type === "location" ? "location_expanded" : "real_world_event_expanded",
            // Nobody did this to them. A Moment arrived at a place they follow.
            actorUserId: undefined,
            subjectUserId: followerUserId,
            sourceType: context.type,
            // The place, not the Moment — so everything arriving there folds
            // into one unread entry rather than one per Moment.
            sourceId: context.id,
            // The Moment whose visibility decides whether this follower may be
            // told at all.
            viaMomentId: momentId,
          },
          event.envelope.eventId,
        );

        if (outcome === "notified") {
          told += 1;
        }
      }

      if (followers.length < FOLLOWERS_PER_PAGE) {
        break;
      }

      after = followers[followers.length - 1];
    }
  }

  logger?.info({ eventId: event.envelope.eventId, momentId, told }, "Told followers of its places");
}
