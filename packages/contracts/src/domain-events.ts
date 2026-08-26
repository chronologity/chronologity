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
  changedAt: timestampSchema,
});

export type ModerationStateChangedPayload = z.infer<
  typeof moderationStateChangedPayloadSchema
>;

export const moderationStateChangedEventSchema = envelopeOf(
  "ModerationStateChanged",
  moderationStateChangedPayloadSchema,
);
