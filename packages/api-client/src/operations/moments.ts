import {
  addMediaRequestSchema,
  assertMomentRelationshipRequestSchema,
  commentPageSchema,
  commentSchema,
  correctOccurrenceRequestSchema,
  createCommentRequestSchema,
  createMomentRequestSchema,
  editCommentRequestSchema,
  identifierSchema,
  listCommentsRequestSchema,
  listMomentsRequestSchema,
  momentAudienceSchema,
  momentPageSchema,
  momentRelationshipListSchema,
  momentRelationshipSchema,
  momentSchema,
  personalSignificanceSchema,
  reactionSummarySchema,
  reorderMediaRequestSchema,
  setCommentPolicyRequestSchema,
  setDiscoverabilityRequestSchema,
  setLocationDisclosureRequestSchema,
  setMomentVisibilityRequestSchema,
  setReactionRequestSchema,
  setReactionsEnabledRequestSchema,
  updateCaptionRequestSchema,
} from "@chronologity/contracts";
import { z } from "zod";
import { defineOperation } from "./operation.js";

/**
 * Something that happened, and everything hanging off it.
 *
 * **Chronology comes from occurrence, never from when something was recorded.**
 * A Moment entered today for 1998 belongs in 1998, and a client must not order
 * anything by creation time or present a backfilled Moment as new.
 *
 * **Media is evidence of the experience; the Moment is the experience.** A
 * Moment with no media is ordinary, and removing the last piece of media is
 * refused rather than silently emptying it.
 *
 * A correction is not an edit of history: occurrence changes are recorded as
 * corrections and the product's immutable-history rules apply.
 */

const momentPath = (args: { params: { momentId: string } }) => `/moments/${args.params.momentId}`;
const commentPath = (args: { params: { commentId: string } }) =>
  `/comments/${args.params.commentId}`;

/** Record a Moment. */
export const recordMoment = defineOperation({
  method: "POST",
  template: "/moments",
  body: createMomentRequestSchema,
  response: momentSchema,
});

/** Moments this account recorded. */
export const listMoments = defineOperation({
  method: "GET",
  template: "/moments",
  query: listMomentsRequestSchema,
  response: momentPageSchema,
});

/** Moments somebody else recorded, filtered for this reader. */
export const listUserMoments = defineOperation({
  method: "GET",
  template: "/users/:userId/moments",
  path: (args: { params: { userId: string } }) => `/users/${args.params.userId}/moments`,
  query: listMomentsRequestSchema,
  response: momentPageSchema,
});

/** One Moment, in full. */
export const getMoment = defineOperation({
  method: "GET",
  template: "/moments/:momentId",
  path: momentPath,
  response: momentSchema,
});

/** Change what a Moment says. */
export const updateCaption = defineOperation({
  method: "PATCH",
  template: "/moments/:momentId",
  path: momentPath,
  body: updateCaptionRequestSchema,
  response: momentSchema,
});

/** Correct when it happened. Recorded as a correction, not an overwrite. */
export const correctOccurrence = defineOperation({
  method: "PUT",
  template: "/moments/:momentId/occurrence",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/occurrence`,
  body: correctOccurrenceRequestSchema,
  response: momentSchema,
});

/** Remove a Moment. */
export const deleteMoment = defineOperation({
  method: "DELETE",
  template: "/moments/:momentId",
  path: momentPath,
  response: z.null(),
});

/** Attach media that has finished processing. */
export const addMedia = defineOperation({
  method: "POST",
  template: "/moments/:momentId/media",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/media`,
  body: addMediaRequestSchema,
  response: momentSchema,
});

/** Put the media in a different order. */
export const reorderMedia = defineOperation({
  method: "PUT",
  template: "/moments/:momentId/media/order",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/media/order`,
  body: reorderMediaRequestSchema,
  response: momentSchema,
});

/** Detach one piece of media. Removing the last is refused. */
export const removeMedia = defineOperation({
  method: "DELETE",
  template: "/moments/:momentId/media/:uploadId",
  path: (args: { params: { momentId: string; uploadId: string } }) =>
    `${momentPath(args)}/media/${args.params.uploadId}`,
  response: momentSchema,
});

/** Say where it happened. */
export const setMomentLocation = defineOperation({
  method: "PUT",
  template: "/moments/:momentId/location",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/location`,
  body: z.object({ locationId: identifierSchema }),
  response: momentSchema,
});

/** Unsay it. */
export const removeMomentLocation = defineOperation({
  method: "DELETE",
  template: "/moments/:momentId/location",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/location`,
  response: momentSchema,
});

/** How precisely the place may be shown, per audience. */
export const setLocationDisclosure = defineOperation({
  method: "PUT",
  template: "/moments/:momentId/location/disclosure",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/location/disclosure`,
  body: setLocationDisclosureRequestSchema,
  response: momentSchema,
});

/** Say it was part of an occasion. */
export const addToRealWorldEvent = defineOperation({
  method: "POST",
  template: "/moments/:momentId/real-world-events",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/real-world-events`,
  body: z.object({ realWorldEventId: identifierSchema }),
  response: momentSchema,
});

/** Unsay that. */
export const removeFromRealWorldEvent = defineOperation({
  method: "DELETE",
  template: "/moments/:momentId/real-world-events/:realWorldEventId",
  path: (args: { params: { momentId: string; realWorldEventId: string } }) =>
    `${momentPath(args)}/real-world-events/${args.params.realWorldEventId}`,
  response: momentSchema,
});

/** Who may see it, and the audience where that is a list. */
export const setVisibility = defineOperation({
  method: "PUT",
  template: "/moments/:momentId/visibility",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/visibility`,
  body: setMomentVisibilityRequestSchema,
  response: momentSchema,
});

/** Who is currently in the audience. */
export const getAudience = defineOperation({
  method: "GET",
  template: "/moments/:momentId/audience",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/audience`,
  response: momentAudienceSchema,
});

/** Whether it may be surfaced to people who did not ask. */
export const setDiscoverability = defineOperation({
  method: "PUT",
  template: "/moments/:momentId/discoverability",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/discoverability`,
  body: setDiscoverabilityRequestSchema,
  response: momentSchema,
});

/** Assert that two Moments are related. */
export const assertRelationship = defineOperation({
  method: "POST",
  template: "/moments/:momentId/relationships",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/relationships`,
  body: assertMomentRelationshipRequestSchema,
  response: momentRelationshipSchema,
});

/**
 * What this Moment is related to.
 *
 * A relationship whose far end this reader may not see comes back marked
 * unavailable rather than absent, so a chain keeps its shape.
 */
export const listRelationships = defineOperation({
  method: "GET",
  template: "/moments/:momentId/relationships",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/relationships`,
  response: momentRelationshipListSchema,
});

/** Withdraw a relationship. */
export const removeRelationship = defineOperation({
  method: "DELETE",
  template: "/moments/:momentId/relationships/:relationshipId",
  path: (args: { params: { momentId: string; relationshipId: string } }) =>
    `${momentPath(args)}/relationships/${args.params.relationshipId}`,
  response: z.null(),
});

/** React to a Moment. */
export const setMomentReaction = defineOperation({
  method: "PUT",
  template: "/moments/:momentId/reaction",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/reaction`,
  body: setReactionRequestSchema,
  response: reactionSummarySchema,
});

/** Take a reaction back. */
export const removeMomentReaction = defineOperation({
  method: "DELETE",
  template: "/moments/:momentId/reaction",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/reaction`,
  response: reactionSummarySchema,
});

/** Counts by kind, and whether reactions are on at all. */
export const getReactions = defineOperation({
  method: "GET",
  template: "/moments/:momentId/reactions",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/reactions`,
  response: reactionSummarySchema,
});

/** Turn reactions on or off for a Moment. */
export const setReactionsEnabled = defineOperation({
  method: "PUT",
  template: "/moments/:momentId/reactions/enabled",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/reactions/enabled`,
  body: setReactionsEnabledRequestSchema,
  response: reactionSummarySchema,
});

/** Say something about a Moment. */
export const createComment = defineOperation({
  method: "POST",
  template: "/moments/:momentId/comments",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/comments`,
  body: createCommentRequestSchema,
  response: commentSchema,
});

/** The discussion on a Moment. */
export const listComments = defineOperation({
  method: "GET",
  template: "/moments/:momentId/comments",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/comments`,
  query: listCommentsRequestSchema,
  response: commentPageSchema,
});

/** Replies under one comment. */
export const listReplies = defineOperation({
  method: "GET",
  template: "/comments/:commentId/replies",
  path: (args: { params: { commentId: string } }) => `${commentPath(args)}/replies`,
  query: listCommentsRequestSchema,
  response: commentPageSchema,
});

/** Change something you said. */
export const editComment = defineOperation({
  method: "PATCH",
  template: "/comments/:commentId",
  path: commentPath,
  body: editCommentRequestSchema,
  response: commentSchema,
});

/** Withdraw it. A tombstone remains so replies keep their shape. */
export const deleteComment = defineOperation({
  method: "DELETE",
  template: "/comments/:commentId",
  path: commentPath,
  response: z.null(),
});

/** Who may comment on a Moment. */
export const setCommentPolicy = defineOperation({
  method: "PUT",
  template: "/moments/:momentId/comments/policy",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/comments/policy`,
  body: setCommentPolicyRequestSchema,
  response: z.null(),
});

/** React to a comment. */
export const setCommentReaction = defineOperation({
  method: "PUT",
  template: "/comments/:commentId/reaction",
  path: (args: { params: { commentId: string } }) => `${commentPath(args)}/reaction`,
  body: setReactionRequestSchema,
  response: commentSchema,
});

/** Take that back. */
export const removeCommentReaction = defineOperation({
  method: "DELETE",
  template: "/comments/:commentId/reaction",
  path: (args: { params: { commentId: string } }) => `${commentPath(args)}/reaction`,
  response: commentSchema,
});

/**
 * Mark a Moment as significant to you.
 *
 * Private, and stays private: it is never visible to anybody else and never
 * influences what anybody else is shown.
 */
export const markSignificant = defineOperation({
  method: "PUT",
  template: "/moments/:momentId/significance",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/significance`,
  response: personalSignificanceSchema,
});

/** Unmark it. Unmarking one you never marked is the state you asked for. */
export const unmarkSignificant = defineOperation({
  method: "DELETE",
  template: "/moments/:momentId/significance",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/significance`,
  response: personalSignificanceSchema,
});

/** Whether you marked it. */
export const getSignificance = defineOperation({
  method: "GET",
  template: "/moments/:momentId/significance",
  path: (args: { params: { momentId: string } }) => `${momentPath(args)}/significance`,
  response: personalSignificanceSchema,
});
