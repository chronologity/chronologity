import { z } from "zod";
import { envelopeOf } from "./event-envelope.js";
import { identifierSchema } from "./identifiers.js";
import { moderationStateSchema, moderationSubjectTypeSchema } from "./moderation.js";
import { momentVisibilitySchema } from "./moments.js";
import { timestampSchema } from "./time.js";

/**
 * Integration events for the domain.
 *
 * The first the platform publishes about its own history — media events aside,
 * which announce a file rather than a fact. These exist because derived state
 * has to learn that something changed: Search first, Timeline projections and
 * notifications after.
 *
 * **They say what changed, not what it now says.** A payload carries the entity
 * and the nature of the change, never a copy of the caption, the place, the
 * associations, or the eligibility. A consumer that needs those reads
 * authoritative state, which settles the open question at `search.md:567` in
 * favour of the reading indexer.
 *
 * Two things follow. A schema change to a Moment is not an event-version change,
 * because no payload describes a Moment. And an event replayed long after the
 * fact produces a current answer rather than resurrecting a stale one, which is
 * the property that makes replay safe rather than merely possible.
 *
 * What a payload does carry beyond the identifier is what a consumer cannot
 * cheaply look up afterwards, or what it needs in order to decide whether to
 * look at all — the author, so a notification knows whom this concerns without
 * a read, and the new state, so a privacy change can be recognised as one.
 */

/** The integration boundary Moment events are published to. */
export const MOMENTS_BOUNDARY = "domain-moments";

/** The integration boundary User events are published to. */
export const USERS_BOUNDARY = "domain-users";

/** The integration boundary real-world Event events are published to. */
export const REAL_WORLD_EVENTS_BOUNDARY = "domain-real-world-events";

/** The integration boundary Location events are published to. */
export const LOCATIONS_BOUNDARY = "domain-locations";

/** The integration boundary moderation events are published to. */
export const MODERATION_BOUNDARY = "domain-moderation";

/** Somebody recorded a Moment. */
export const momentRecordedPayloadSchema = z.object({
  momentId: identifierSchema,
  authorUserId: identifierSchema,
  recordedAt: timestampSchema,
});

export type MomentRecordedPayload = z.infer<typeof momentRecordedPayloadSchema>;

export const momentRecordedEventSchema = envelopeOf(
  "MomentRecorded",
  momentRecordedPayloadSchema,
);

/**
 * What kind of revision a Moment received.
 *
 * Carried so a consumer can decide whether it cares — a notification about a
 * corrected date is not a notification about a new photograph — and
 * deliberately not so anybody can reconstruct the change from it.
 */
export const momentRevisionSchema = z.enum([
  "caption",
  "occurrence",
  "location",
  "real_world_events",
  "media",
  "interaction_settings",
]);

export type MomentRevision = z.infer<typeof momentRevisionSchema>;

/**
 * A Moment changed.
 *
 * One event for every kind of revision rather than one per field. The Search
 * indexer rebuilds the whole document from authoritative state whichever arrives,
 * so splitting this would multiply event types without changing a single
 * document. `kind` is there for the consumers that will care, not for the one
 * that prompted it.
 */
export const momentRevisedPayloadSchema = z.object({
  momentId: identifierSchema,
  authorUserId: identifierSchema,
  kind: momentRevisionSchema,
  revisedAt: timestampSchema,
});

export type MomentRevisedPayload = z.infer<typeof momentRevisedPayloadSchema>;

export const momentRevisedEventSchema = envelopeOf("MomentRevised", momentRevisedPayloadSchema);

/**
 * Who may see a Moment changed.
 *
 * Its own event rather than a revision kind, because a privacy change is a
 * different obligation from a content change: `search.md:293` asks that
 * restriction be recognisable as such, and a consumer should not have to inspect
 * a `kind` field to discover it is holding one.
 */
export const momentVisibilityChangedPayloadSchema = z.object({
  momentId: identifierSchema,
  authorUserId: identifierSchema,
  visibility: momentVisibilitySchema,
  changedAt: timestampSchema,
});

export type MomentVisibilityChangedPayload = z.infer<
  typeof momentVisibilityChangedPayloadSchema
>;

export const momentVisibilityChangedEventSchema = envelopeOf(
  "MomentVisibilityChanged",
  momentVisibilityChangedPayloadSchema,
);

/**
 * A Moment was withdrawn from ordinary access.
 *
 * Not an assertion that it stopped happening. Derived state removes its
 * document; nothing about occurrence, authorship, or chronology is affected.
 */
export const momentRemovedPayloadSchema = z.object({
  momentId: identifierSchema,
  authorUserId: identifierSchema,
  removedAt: timestampSchema,
});

export type MomentRemovedPayload = z.infer<typeof momentRemovedPayloadSchema>;

export const momentRemovedEventSchema = envelopeOf("MomentRemoved", momentRemovedPayloadSchema);

/** An account finished being created. */
export const userCreatedPayloadSchema = z.object({
  userId: identifierSchema,
  createdAt: timestampSchema,
});

export type UserCreatedPayload = z.infer<typeof userCreatedPayloadSchema>;

export const userCreatedEventSchema = envelopeOf("UserCreated", userCreatedPayloadSchema);

/**
 * How somebody presents themselves changed.
 *
 * Carries no names. A display name and a handle are both searchable and both
 * changeable, and putting either in a payload would scatter copies of them
 * across a log with its own retention.
 */
export const userProfileChangedPayloadSchema = z.object({
  userId: identifierSchema,
  changedAt: timestampSchema,
});

export type UserProfileChangedPayload = z.infer<typeof userProfileChangedPayloadSchema>;

export const userProfileChangedEventSchema = envelopeOf(
  "UserProfileChanged",
  userProfileChangedPayloadSchema,
);

/**
 * An account became active, deactivated, or suspended.
 *
 * The status travels because it decides whether everything the account authored
 * stays findable, and a consumer holding this event should not have to read the
 * account to discover it is holding a restriction.
 */
export const userStatusChangedPayloadSchema = z.object({
  userId: identifierSchema,
  status: z.enum(["active", "deactivated", "suspended"]),
  changedAt: timestampSchema,
});

export type UserStatusChangedPayload = z.infer<typeof userStatusChangedPayloadSchema>;

export const userStatusChangedEventSchema = envelopeOf(
  "UserStatusChanged",
  userStatusChangedPayloadSchema,
);

/** A real-world Event was recorded. */
export const realWorldEventRecordedPayloadSchema = z.object({
  realWorldEventId: identifierSchema,
  recordedAt: timestampSchema,
});

export type RealWorldEventRecordedPayload = z.infer<
  typeof realWorldEventRecordedPayloadSchema
>;

export const realWorldEventRecordedEventSchema = envelopeOf(
  "RealWorldEventRecorded",
  realWorldEventRecordedPayloadSchema,
);

/** A real-world Event changed — its name, its dates, its aliases, or its places. */
export const realWorldEventRevisedPayloadSchema = z.object({
  realWorldEventId: identifierSchema,
  revisedAt: timestampSchema,
});

export type RealWorldEventRevisedPayload = z.infer<typeof realWorldEventRevisedPayloadSchema>;

export const realWorldEventRevisedEventSchema = envelopeOf(
  "RealWorldEventRevised",
  realWorldEventRevisedPayloadSchema,
);

/** A Location was recorded. */
export const locationRecordedPayloadSchema = z.object({
  locationId: identifierSchema,
  recordedAt: timestampSchema,
});

export type LocationRecordedPayload = z.infer<typeof locationRecordedPayloadSchema>;

export const locationRecordedEventSchema = envelopeOf(
  "LocationRecorded",
  locationRecordedPayloadSchema,
);

/** A Location changed. */
export const locationRevisedPayloadSchema = z.object({
  locationId: identifierSchema,
  revisedAt: timestampSchema,
});

export type LocationRevisedPayload = z.infer<typeof locationRevisedPayloadSchema>;

export const locationRevisedEventSchema = envelopeOf(
  "LocationRevised",
  locationRevisedPayloadSchema,
);

/**
 * Chronologity decided something about a subject.
 *
 * Carries the state because that is the whole content of the decision, and
 * carries no reason: a moderator's words are for the person affected and for the
 * appeal, not for every consumer of a topic.
 */
export const moderationStateChangedPayloadSchema = z.object({
  subjectType: moderationSubjectTypeSchema,
  subjectId: identifierSchema,
  state: moderationStateSchema,
  /**
   * Whose content it was.
   *
   * Carried because the person affected has to be told, and a consumer should
   * not have to walk four content tables to discover who that is. Deliberately
   * not the moderator: reviewer identity is kept out of what the affected
   * person sees, so a payload that carried it would put it within reach of
   * anything that subscribes.
   */
  affectedUserId: identifierSchema.nullable(),
  changedAt: timestampSchema,
});

export type ModerationStateChangedPayload = z.infer<
  typeof moderationStateChangedPayloadSchema
>;

export const moderationStateChangedEventSchema = envelopeOf(
  "ModerationStateChanged",
  moderationStateChangedPayloadSchema,
);

/** The integration boundary reaction events are published to. */
export const REACTIONS_BOUNDARY = "domain-reactions";

/** The integration boundary comment events are published to. */
export const COMMENTS_BOUNDARY = "domain-comments";

/** The integration boundary social events are published to. */
export const SOCIAL_BOUNDARY = "domain-social";

/**
 * Somebody responded to a Moment.
 *
 * Carries the kind, because a consumer deciding whether to interrupt somebody
 * may care that a reaction was `saddened` rather than `amused`. It carries
 * nothing about the Moment: what it says, where it happened, and who else has
 * responded are all things a consumer reads for itself, from state that still
 * knows who may see them.
 */
export const momentReactedPayloadSchema = z.object({
  momentId: identifierSchema,
  /** Whose Moment it is. The recipient of anything this prompts. */
  authorUserId: identifierSchema,
  /** Who responded. */
  actorUserId: identifierSchema,
  kind: z.string().min(1),
  reactedAt: timestampSchema,
});

export type MomentReactedPayload = z.infer<typeof momentReactedPayloadSchema>;

export const momentReactedEventSchema = envelopeOf("MomentReacted", momentReactedPayloadSchema);

/** Somebody responded to a comment. */
export const commentReactedPayloadSchema = z.object({
  commentId: identifierSchema,
  momentId: identifierSchema,
  /** Whose comment it is. */
  authorUserId: identifierSchema,
  actorUserId: identifierSchema,
  kind: z.string().min(1),
  reactedAt: timestampSchema,
});

export type CommentReactedPayload = z.infer<typeof commentReactedPayloadSchema>;

export const commentReactedEventSchema = envelopeOf("CommentReacted", commentReactedPayloadSchema);

/**
 * Somebody said something about a Moment.
 *
 * No text. A comment is the most sensitive thing anybody writes here after a
 * caption, and a payload carrying it would put it in a message log with its own
 * retention, reachable by anything that subscribes.
 */
export const momentCommentedPayloadSchema = z.object({
  commentId: identifierSchema,
  momentId: identifierSchema,
  /** Whose Moment it is. */
  momentAuthorUserId: identifierSchema,
  /** Who said it. */
  actorUserId: identifierSchema,
  commentedAt: timestampSchema,
});

export type MomentCommentedPayload = z.infer<typeof momentCommentedPayloadSchema>;

export const momentCommentedEventSchema = envelopeOf(
  "MomentCommented",
  momentCommentedPayloadSchema,
);

/** Somebody answered a comment. */
export const commentRepliedPayloadSchema = z.object({
  commentId: identifierSchema,
  momentId: identifierSchema,
  /** The comment being answered. */
  inReplyToCommentId: identifierSchema,
  /** Whose comment was answered. */
  inReplyToAuthorUserId: identifierSchema,
  actorUserId: identifierSchema,
  repliedAt: timestampSchema,
});

export type CommentRepliedPayload = z.infer<typeof commentRepliedPayloadSchema>;

export const commentRepliedEventSchema = envelopeOf("CommentReplied", commentRepliedPayloadSchema);

/**
 * Somebody named another person in a comment.
 *
 * One event per person named, so a consumer never has to fan a single message
 * out to several recipients and get the count wrong on a redelivery.
 */
export const commentMentionedPayloadSchema = z.object({
  commentId: identifierSchema,
  momentId: identifierSchema,
  /** Who was named. */
  mentionedUserId: identifierSchema,
  actorUserId: identifierSchema,
  mentionedAt: timestampSchema,
});

export type CommentMentionedPayload = z.infer<typeof commentMentionedPayloadSchema>;

export const commentMentionedEventSchema = envelopeOf(
  "CommentMentioned",
  commentMentionedPayloadSchema,
);

/** Somebody started following an account. */
export const userFollowedPayloadSchema = z.object({
  /** Who is now followed. */
  followedUserId: identifierSchema,
  actorUserId: identifierSchema,
  followedAt: timestampSchema,
});

export type UserFollowedPayload = z.infer<typeof userFollowedPayloadSchema>;

export const userFollowedEventSchema = envelopeOf("UserFollowed", userFollowedPayloadSchema);

/** Somebody asked to follow an account that approves its followers. */
export const followRequestedPayloadSchema = z.object({
  requestId: identifierSchema,
  followedUserId: identifierSchema,
  actorUserId: identifierSchema,
  requestedAt: timestampSchema,
});

export type FollowRequestedPayload = z.infer<typeof followRequestedPayloadSchema>;

export const followRequestedEventSchema = envelopeOf(
  "FollowRequested",
  followRequestedPayloadSchema,
);

/**
 * A follow request was granted.
 *
 * The recipient is the person who asked, which is the one case in this file
 * where the actor and the subject are the other way round from the events
 * above: the account being followed is the one acting.
 */
export const followRequestAcceptedPayloadSchema = z.object({
  requestId: identifierSchema,
  /** Who asked, and who hears that they were accepted. */
  requesterUserId: identifierSchema,
  /** Who accepted. */
  actorUserId: identifierSchema,
  acceptedAt: timestampSchema,
});

export type FollowRequestAcceptedPayload = z.infer<typeof followRequestAcceptedPayloadSchema>;

export const followRequestAcceptedEventSchema = envelopeOf(
  "FollowRequestAccepted",
  followRequestAcceptedPayloadSchema,
);

/**
 * The integration boundary account-security events are published to.
 *
 * Its own boundary rather than a corner of `domain-users`. What these describe
 * is the Identity that signs in, not the User everybody else sees, and the two
 * are deliberately separate everywhere else in this system. Keeping them apart
 * here means a consumer that wants profile changes does not have to read past
 * credential changes to find them.
 */
export const SECURITY_BOUNDARY = "domain-security";

/**
 * Something changed about how an account is secured.
 *
 * One event with a `change` rather than six, following `ModerationStateChanged`
 * above: the payload is identical for every one of them, the notification type
 * maps straight from the field, and a seventh security fact later is an
 * additive enum value rather than a new topic for every consumer to subscribe
 * to.
 *
 * These exist to be told to the account owner. Each one is a step somebody
 * taking over an account has to perform, so each is a chance for the real owner
 * to notice — which is the whole reason `architecture/notifications.md:749`
 * lets security email past a preference that would otherwise silence it.
 *
 * **Nothing here is a credential.** No password, no hash, no token, no phone
 * number, and no email address: a consumer that needs to reach somebody reads
 * the address from authoritative state, where erasure can still reach it.
 */
export const accountSecurityChangeSchema = z.enum([
  "password_set",
  "password_changed",
  "phone_claimed",
  "phone_removed",
  "email_verified",
  "sessions_revoked",
]);

export type AccountSecurityChange = z.infer<typeof accountSecurityChangeSchema>;

export const accountSecurityChangedPayloadSchema = z.object({
  identityId: identifierSchema,
  /**
   * The account this Identity signs in to, where there is one.
   *
   * Null during registration, which happens before a User exists. The fact is
   * still published — it is a fact about this system's history either way — and
   * a consumer with nobody to tell does nothing with it.
   */
  userId: identifierSchema.nullable(),
  change: accountSecurityChangeSchema,
  changedAt: timestampSchema,
});

export type AccountSecurityChangedPayload = z.infer<typeof accountSecurityChangedPayloadSchema>;

export const accountSecurityChangedEventSchema = envelopeOf(
  "AccountSecurityChanged",
  accountSecurityChangedPayloadSchema,
);

/**
 * The participation boundary.
 *
 * Its own rather than folded into `domain-social`, because what these carry is
 * a claim about where somebody was and who they were with — which
 * `privacy.md:300` singles out as disclosing more than a name — and a boundary
 * is the unit a consumer subscribes to. A worker that wants follows should not
 * have to receive these to get them.
 */
export const PARTICIPATION_BOUNDARY = "domain-participation";

/**
 * A creator has said somebody was part of a Moment.
 *
 * Carries who, which Moment, and when it was asked. Deliberately not what the
 * Moment says, where it happened, or when it happened: the person named
 * frequently cannot read the Moment, and a message on a topic with its own
 * retention is the last place to put what the API is careful not to disclose.
 *
 * The proposal is a question. Until it is answered this asserts nothing.
 */
export const participationProposedPayloadSchema = z.object({
  participationId: identifierSchema,
  momentId: identifierSchema,
  /** Who is said to have been there, and who alone may answer. */
  userId: identifierSchema,
  /** The Moment's author, who is the only person who may propose. */
  proposedByUserId: identifierSchema,
  proposedAt: timestampSchema,
});

export type ParticipationProposedPayload = z.infer<typeof participationProposedPayloadSchema>;

export const participationProposedEventSchema = envelopeOf(
  "ParticipationProposed",
  participationProposedPayloadSchema,
);

/** The person named confirmed they were there. */
export const participationAcceptedPayloadSchema = z.object({
  participationId: identifierSchema,
  momentId: identifierSchema,
  userId: identifierSchema,
  proposedByUserId: identifierSchema,
  acceptedAt: timestampSchema,
});

export type ParticipationAcceptedPayload = z.infer<typeof participationAcceptedPayloadSchema>;

export const participationAcceptedEventSchema = envelopeOf(
  "ParticipationAccepted",
  participationAcceptedPayloadSchema,
);

/**
 * The person named refused.
 *
 * Published, and the creator is told, because silence and refusal are different
 * facts — a creator who cannot tell them apart will ask again outside the
 * product, which is the conversation this model deliberately does not carry.
 */
export const participationRejectedPayloadSchema = z.object({
  participationId: identifierSchema,
  momentId: identifierSchema,
  userId: identifierSchema,
  proposedByUserId: identifierSchema,
  rejectedAt: timestampSchema,
});

export type ParticipationRejectedPayload = z.infer<typeof participationRejectedPayloadSchema>;

export const participationRejectedEventSchema = envelopeOf(
  "ParticipationRejected",
  participationRejectedPayloadSchema,
);

/**
 * Somebody has taken back a participation they had accepted.
 *
 * A separate fact from a rejection: this one was true and has been retracted,
 * and whatever was derived from it must be undone rather than never built.
 */
export const participationWithdrawnPayloadSchema = z.object({
  participationId: identifierSchema,
  momentId: identifierSchema,
  userId: identifierSchema,
  proposedByUserId: identifierSchema,
  withdrawnAt: timestampSchema,
});

export type ParticipationWithdrawnPayload = z.infer<typeof participationWithdrawnPayloadSchema>;

export const participationWithdrawnEventSchema = envelopeOf(
  "ParticipationWithdrawn",
  participationWithdrawnPayloadSchema,
);
