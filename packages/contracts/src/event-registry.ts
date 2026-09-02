import type { z } from "zod";
import {
  COMMENTS_BOUNDARY,
  LOCATIONS_BOUNDARY,
  MODERATION_BOUNDARY,
  MOMENTS_BOUNDARY,
  REACTIONS_BOUNDARY,
  REAL_WORLD_EVENTS_BOUNDARY,
  SECURITY_BOUNDARY,
  SOCIAL_BOUNDARY,
  USERS_BOUNDARY,
  accountSecurityChangedEventSchema,
  accountSecurityChangedPayloadSchema,
  commentMentionedEventSchema,
  commentMentionedPayloadSchema,
  commentReactedEventSchema,
  commentReactedPayloadSchema,
  commentRepliedEventSchema,
  commentRepliedPayloadSchema,
  followRequestAcceptedEventSchema,
  followRequestAcceptedPayloadSchema,
  followRequestedEventSchema,
  followRequestedPayloadSchema,
  locationRecordedEventSchema,
  locationRecordedPayloadSchema,
  locationRevisedEventSchema,
  locationRevisedPayloadSchema,
  moderationStateChangedEventSchema,
  moderationStateChangedPayloadSchema,
  momentCommentedEventSchema,
  momentCommentedPayloadSchema,
  momentReactedEventSchema,
  momentReactedPayloadSchema,
  momentRecordedEventSchema,
  momentRecordedPayloadSchema,
  momentRemovedEventSchema,
  momentRemovedPayloadSchema,
  momentRevisedEventSchema,
  momentRevisedPayloadSchema,
  momentVisibilityChangedEventSchema,
  momentVisibilityChangedPayloadSchema,
  realWorldEventRecordedEventSchema,
  realWorldEventRecordedPayloadSchema,
  realWorldEventRevisedEventSchema,
  realWorldEventRevisedPayloadSchema,
  userCreatedEventSchema,
  userCreatedPayloadSchema,
  userFollowedEventSchema,
  userFollowedPayloadSchema,
  userProfileChangedEventSchema,
  userProfileChangedPayloadSchema,
  userStatusChangedEventSchema,
  userStatusChangedPayloadSchema,
  PARTICIPATION_BOUNDARY,
  participationProposedEventSchema,
  participationProposedPayloadSchema,
  participationAcceptedEventSchema,
  participationAcceptedPayloadSchema,
  participationRejectedEventSchema,
  participationRejectedPayloadSchema,
  participationWithdrawnEventSchema,
  participationWithdrawnPayloadSchema,
} from "./domain-events.js";
import { MEDIA_BOUNDARY, uploadReceivedEventSchema, uploadReceivedPayloadSchema } from "./media-events.js";

/**
 * The canonical registry of everything this platform publishes.
 *
 * `events.md:782` asks for a registry mapping type, version, schema, owner, and
 * classification, and says it may be code-driven rather than a runtime service.
 * This is that registry, and it is deliberately data: a table can be walked, so
 * a property asserted here holds for every event rather than for the ones
 * somebody remembered to write a test for.
 *
 * What it buys, in the order `events.md:797` lists: a duplicate name is a
 * failing test rather than two consumers quietly disagreeing; a version
 * collision likewise; a payload with no runtime validation cannot exist,
 * because registration is what supplies the schema; ownership is written down;
 * and an event nobody registered is caught the first time anything publishes
 * one.
 *
 * **An entry is a promise, not a description.** Adding one commits this system
 * to a shape that consumers may depend on, which is why the accompanying tests
 * refuse the removal of any field rather than merely accepting the current one.
 */

/**
 * Which kind of event this is, in the taxonomy of `events.md:155`.
 *
 * Everything registered today is an Integration Event: published across a
 * boundary, versioned, and carried by the outbox. Domain Events stay inside the
 * API as rows; External and Operational events do not exist yet. The field is
 * here because the registry is the place that will have to tell them apart, and
 * a taxonomy discovered later is a migration rather than an addition.
 */
export type EventClassification = "domain" | "integration" | "external" | "operational";

/** One event, and everything the platform needs to know about it. */
export interface RegisteredEvent {
  /** The name on the wire. Unique across the registry. */
  readonly type: string;
  /**
   * The payload's contract version.
   *
   * Distinct from the topic's major version, which is part of its name. This
   * one changes when the payload does, compatibly; the other changes when the
   * envelope does, incompatibly.
   */
  readonly version: number;
  /** The whole message, envelope included, bound to this one type. */
  readonly envelope: z.ZodType;
  /** Just the payload, so a test can reason about its fields. */
  readonly payload: z.ZodObject;
  /** The integration boundary it is published to, before topic naming. */
  readonly boundary: string;
  /** The feature responsible for publishing it, per `events.md:205`. */
  readonly owner: string;
  readonly classification: EventClassification;
  /**
   * A payload that this event's schema accepts.
   *
   * Documentation that cannot go stale, and the material the contract tests
   * work from: each field is removed in turn and the result must be refused,
   * which is what makes a field disappearing a failure rather than a surprise
   * somebody meets in production.
   */
  readonly example: Readonly<Record<string, unknown>>;
}

const MOMENT_ID = "6f1c9c4e-6f4a-4a1e-8b2f-2f9a3c5d1e70";
const COMMENT_ID = "1c9f2a3b-4d5e-4f60-9a71-8b2c3d4e5f60";
const USER_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const ACTOR_ID = "2b3c4d5e-6f70-4812-9a3b-4c5d6e7f8091";
const IDENTITY_ID = "7d6c5b4a-3928-4716-8a5b-4c3d2e1f0a9b";
const LOCATION_ID = "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b";
const REAL_WORLD_EVENT_ID = "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c";
const REQUEST_ID = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
const UPLOAD_ID = "8b7a6c5d-4e3f-4a29-9b8c-7d6e5f4a3b2c";
const PARTICIPATION_ID = "6c7d8e9f-0a1b-4c2d-9e3f-4a5b6c7d8e9f";
const AT = "2026-08-27T09:15:00Z";

/**
 * Every Integration Event Chronologity publishes, or has promised to.
 *
 * Three entries have no publisher yet, deliberately. `LocationRevised` and
 * `RealWorldEventRevised` are contracts written ahead of the operations that
 * will raise them, and the Search indexer already handles both. They are
 * registered so that the operation, when it arrives, is written against a
 * pinned shape rather than inventing one.
 */
export const EVENT_REGISTRY: readonly RegisteredEvent[] = [
  {
    type: "MomentRecorded",
    version: 1,
    envelope: momentRecordedEventSchema,
    payload: momentRecordedPayloadSchema,
    boundary: MOMENTS_BOUNDARY,
    owner: "moments",
    classification: "integration",
    example: { momentId: MOMENT_ID, authorUserId: USER_ID, recordedAt: AT },
  },
  {
    type: "MomentRevised",
    version: 1,
    envelope: momentRevisedEventSchema,
    payload: momentRevisedPayloadSchema,
    boundary: MOMENTS_BOUNDARY,
    owner: "moments",
    classification: "integration",
    example: { momentId: MOMENT_ID, authorUserId: USER_ID, kind: "caption", revisedAt: AT },
  },
  {
    type: "MomentVisibilityChanged",
    version: 1,
    envelope: momentVisibilityChangedEventSchema,
    payload: momentVisibilityChangedPayloadSchema,
    boundary: MOMENTS_BOUNDARY,
    owner: "moments",
    classification: "integration",
    example: {
      momentId: MOMENT_ID,
      authorUserId: USER_ID,
      visibility: "restricted",
      changedAt: AT,
    },
  },
  {
    type: "MomentRemoved",
    version: 1,
    envelope: momentRemovedEventSchema,
    payload: momentRemovedPayloadSchema,
    boundary: MOMENTS_BOUNDARY,
    owner: "moments",
    classification: "integration",
    example: { momentId: MOMENT_ID, authorUserId: USER_ID, removedAt: AT },
  },
  {
    type: "UserCreated",
    version: 1,
    envelope: userCreatedEventSchema,
    payload: userCreatedPayloadSchema,
    boundary: USERS_BOUNDARY,
    owner: "users",
    classification: "integration",
    example: { userId: USER_ID, createdAt: AT },
  },
  {
    type: "UserProfileChanged",
    version: 1,
    envelope: userProfileChangedEventSchema,
    payload: userProfileChangedPayloadSchema,
    boundary: USERS_BOUNDARY,
    owner: "users",
    classification: "integration",
    example: { userId: USER_ID, changedAt: AT },
  },
  {
    type: "UserStatusChanged",
    version: 1,
    envelope: userStatusChangedEventSchema,
    payload: userStatusChangedPayloadSchema,
    boundary: USERS_BOUNDARY,
    owner: "users",
    classification: "integration",
    example: { userId: USER_ID, status: "suspended", changedAt: AT },
  },
  {
    type: "RealWorldEventRecorded",
    version: 1,
    envelope: realWorldEventRecordedEventSchema,
    payload: realWorldEventRecordedPayloadSchema,
    boundary: REAL_WORLD_EVENTS_BOUNDARY,
    owner: "real-world-events",
    classification: "integration",
    example: { realWorldEventId: REAL_WORLD_EVENT_ID, recordedAt: AT },
  },
  {
    type: "RealWorldEventRevised",
    version: 1,
    envelope: realWorldEventRevisedEventSchema,
    payload: realWorldEventRevisedPayloadSchema,
    boundary: REAL_WORLD_EVENTS_BOUNDARY,
    owner: "real-world-events",
    classification: "integration",
    example: { realWorldEventId: REAL_WORLD_EVENT_ID, revisedAt: AT },
  },
  {
    type: "LocationRecorded",
    version: 1,
    envelope: locationRecordedEventSchema,
    payload: locationRecordedPayloadSchema,
    boundary: LOCATIONS_BOUNDARY,
    owner: "locations",
    classification: "integration",
    example: { locationId: LOCATION_ID, recordedAt: AT },
  },
  {
    type: "LocationRevised",
    version: 1,
    envelope: locationRevisedEventSchema,
    payload: locationRevisedPayloadSchema,
    boundary: LOCATIONS_BOUNDARY,
    owner: "locations",
    classification: "integration",
    example: { locationId: LOCATION_ID, revisedAt: AT },
  },
  {
    type: "ModerationStateChanged",
    version: 1,
    envelope: moderationStateChangedEventSchema,
    payload: moderationStateChangedPayloadSchema,
    boundary: MODERATION_BOUNDARY,
    owner: "moderation",
    classification: "integration",
    example: {
      subjectType: "moment",
      subjectId: MOMENT_ID,
      state: "temporarily_unavailable",
      affectedUserId: USER_ID,
      changedAt: AT,
    },
  },
  {
    type: "MomentReacted",
    version: 1,
    envelope: momentReactedEventSchema,
    payload: momentReactedPayloadSchema,
    boundary: REACTIONS_BOUNDARY,
    owner: "moments",
    classification: "integration",
    example: {
      momentId: MOMENT_ID,
      authorUserId: USER_ID,
      actorUserId: ACTOR_ID,
      kind: "loved",
      reactedAt: AT,
    },
  },
  {
    type: "CommentReacted",
    version: 1,
    envelope: commentReactedEventSchema,
    payload: commentReactedPayloadSchema,
    boundary: REACTIONS_BOUNDARY,
    owner: "moments",
    classification: "integration",
    example: {
      commentId: COMMENT_ID,
      momentId: MOMENT_ID,
      authorUserId: USER_ID,
      actorUserId: ACTOR_ID,
      kind: "loved",
      reactedAt: AT,
    },
  },
  {
    type: "MomentCommented",
    version: 1,
    envelope: momentCommentedEventSchema,
    payload: momentCommentedPayloadSchema,
    boundary: COMMENTS_BOUNDARY,
    owner: "moments",
    classification: "integration",
    example: {
      commentId: COMMENT_ID,
      momentId: MOMENT_ID,
      momentAuthorUserId: USER_ID,
      actorUserId: ACTOR_ID,
      commentedAt: AT,
    },
  },
  {
    type: "CommentReplied",
    version: 1,
    envelope: commentRepliedEventSchema,
    payload: commentRepliedPayloadSchema,
    boundary: COMMENTS_BOUNDARY,
    owner: "moments",
    classification: "integration",
    example: {
      commentId: COMMENT_ID,
      momentId: MOMENT_ID,
      inReplyToCommentId: "0f1e2d3c-4b5a-4968-8778-6a5b4c3d2e1f",
      inReplyToAuthorUserId: USER_ID,
      actorUserId: ACTOR_ID,
      repliedAt: AT,
    },
  },
  {
    type: "CommentMentioned",
    version: 1,
    envelope: commentMentionedEventSchema,
    payload: commentMentionedPayloadSchema,
    boundary: COMMENTS_BOUNDARY,
    owner: "moments",
    classification: "integration",
    example: {
      commentId: COMMENT_ID,
      momentId: MOMENT_ID,
      mentionedUserId: USER_ID,
      actorUserId: ACTOR_ID,
      mentionedAt: AT,
    },
  },
  {
    type: "UserFollowed",
    version: 1,
    envelope: userFollowedEventSchema,
    payload: userFollowedPayloadSchema,
    boundary: SOCIAL_BOUNDARY,
    owner: "social",
    classification: "integration",
    example: { followedUserId: USER_ID, actorUserId: ACTOR_ID, followedAt: AT },
  },
  {
    type: "FollowRequested",
    version: 1,
    envelope: followRequestedEventSchema,
    payload: followRequestedPayloadSchema,
    boundary: SOCIAL_BOUNDARY,
    owner: "social",
    classification: "integration",
    example: {
      requestId: REQUEST_ID,
      followedUserId: USER_ID,
      actorUserId: ACTOR_ID,
      requestedAt: AT,
    },
  },
  {
    type: "FollowRequestAccepted",
    version: 1,
    envelope: followRequestAcceptedEventSchema,
    payload: followRequestAcceptedPayloadSchema,
    boundary: SOCIAL_BOUNDARY,
    owner: "social",
    classification: "integration",
    example: {
      requestId: REQUEST_ID,
      requesterUserId: ACTOR_ID,
      actorUserId: USER_ID,
      acceptedAt: AT,
    },
  },
  {
    type: "AccountSecurityChanged",
    version: 1,
    envelope: accountSecurityChangedEventSchema,
    payload: accountSecurityChangedPayloadSchema,
    boundary: SECURITY_BOUNDARY,
    owner: "authentication",
    classification: "integration",
    example: {
      identityId: IDENTITY_ID,
      userId: USER_ID,
      change: "password_changed",
      changedAt: AT,
    },
  },
  {
    type: "UploadReceived",
    version: 1,
    envelope: uploadReceivedEventSchema,
    payload: uploadReceivedPayloadSchema,
    boundary: MEDIA_BOUNDARY,
    owner: "uploads",
    classification: "integration",
    example: {
      uploadId: UPLOAD_ID,
      ownerUserId: USER_ID,
      kind: "image",
      storageKey: "uploads/2026/08/27/original",
      receivedAt: AT,
    },
  },
  {
    type: "ParticipationProposed",
    version: 1,
    envelope: participationProposedEventSchema,
    payload: participationProposedPayloadSchema,
    boundary: PARTICIPATION_BOUNDARY,
    owner: "participation",
    classification: "integration",
    example: {
      participationId: PARTICIPATION_ID,
      momentId: MOMENT_ID,
      userId: USER_ID,
      proposedByUserId: ACTOR_ID,
      proposedAt: AT,
    },
  },
  {
    type: "ParticipationAccepted",
    version: 1,
    envelope: participationAcceptedEventSchema,
    payload: participationAcceptedPayloadSchema,
    boundary: PARTICIPATION_BOUNDARY,
    owner: "participation",
    classification: "integration",
    example: {
      participationId: PARTICIPATION_ID,
      momentId: MOMENT_ID,
      userId: USER_ID,
      proposedByUserId: ACTOR_ID,
      acceptedAt: AT,
    },
  },
  {
    type: "ParticipationRejected",
    version: 1,
    envelope: participationRejectedEventSchema,
    payload: participationRejectedPayloadSchema,
    boundary: PARTICIPATION_BOUNDARY,
    owner: "participation",
    classification: "integration",
    example: {
      participationId: PARTICIPATION_ID,
      momentId: MOMENT_ID,
      userId: USER_ID,
      proposedByUserId: ACTOR_ID,
      rejectedAt: AT,
    },
  },
  {
    type: "ParticipationWithdrawn",
    version: 1,
    envelope: participationWithdrawnEventSchema,
    payload: participationWithdrawnPayloadSchema,
    boundary: PARTICIPATION_BOUNDARY,
    owner: "participation",
    classification: "integration",
    example: {
      participationId: PARTICIPATION_ID,
      momentId: MOMENT_ID,
      userId: USER_ID,
      proposedByUserId: ACTOR_ID,
      withdrawnAt: AT,
    },
  },
];

const BY_TYPE = new Map(EVENT_REGISTRY.map((event) => [event.type, event]));

/**
 * Look an event up by the name it travels under.
 *
 * @param type - The `eventType` from an envelope.
 * @returns Its registration, or undefined for a type this platform does not
 *   publish — which a consumer should treat as something to ignore rather than
 *   something to fail on, since a boundary gains types over time.
 */
export function registeredEvent(type: string): RegisteredEvent | undefined {
  return BY_TYPE.get(type);
}

/**
 * Which boundary an event is published to.
 *
 * @param type - The `eventType` from an envelope.
 * @returns The boundary, or undefined if the type is not registered.
 */
export function boundaryOf(type: string): string | undefined {
  return BY_TYPE.get(type)?.boundary;
}
