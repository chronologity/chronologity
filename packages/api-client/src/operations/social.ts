import {
  followListSchema,
  followOutcomeSchema,
  followRequestListSchema,
  followedEventListSchema,
  followedLocationListSchema,
  listFollowsRequestSchema,
} from "@chronologity/contracts";
import { z } from "zod";
import { defineOperation } from "./operation.js";

/**
 * Following, and blocking.
 *
 * **Following says what somebody wants to hear about, never what they may see.**
 * That separation runs through the whole product: unfollowing does not remove
 * access, and following does not grant it. A client that presents following as a
 * permission is describing a different system.
 *
 * **Blocking is symmetric and its direction is not disclosable.** There is a way
 * to list who this account has blocked and deliberately no way to learn who has
 * blocked it — a client must not infer the second from an absence.
 *
 * Following an account may or may not take effect immediately, which is why
 * `followUser` returns an outcome rather than nothing: a private account turns
 * it into a request somebody has to accept.
 */

/** Follow somebody. Becomes a request where their account requires one. */
export const followUser = defineOperation({
  method: "POST",
  template: "/users/:userId/follow",
  path: (args: { params: { userId: string } }) => `/users/${args.params.userId}/follow`,
  response: followOutcomeSchema,
});

/** Stop following somebody. */
export const unfollowUser = defineOperation({
  method: "DELETE",
  template: "/users/:userId/follow",
  path: (args: { params: { userId: string } }) => `/users/${args.params.userId}/follow`,
  response: z.null(),
});

/** Remove one of your followers. */
export const removeFollower = defineOperation({
  method: "DELETE",
  template: "/followers/:userId",
  path: (args: { params: { userId: string } }) => `/followers/${args.params.userId}`,
  response: z.null(),
});

/** Block somebody. Takes effect in both directions. */
export const blockUser = defineOperation({
  method: "POST",
  template: "/users/:userId/block",
  path: (args: { params: { userId: string } }) => `/users/${args.params.userId}/block`,
  response: z.null(),
});

/** Unblock somebody. */
export const unblockUser = defineOperation({
  method: "DELETE",
  template: "/users/:userId/block",
  path: (args: { params: { userId: string } }) => `/users/${args.params.userId}/block`,
  response: z.null(),
});

/** Who this account has blocked. There is no way to ask the reverse. */
export const listBlocks = defineOperation({
  method: "GET",
  template: "/blocks",
  query: listFollowsRequestSchema,
  response: followListSchema,
});

/** Follow an occasion. */
export const followRealWorldEvent = defineOperation({
  method: "POST",
  template: "/real-world-events/:realWorldEventId/follow",
  path: (args: { params: { realWorldEventId: string } }) =>
    `/real-world-events/${args.params.realWorldEventId}/follow`,
  response: z.null(),
});

/** Stop following an occasion. */
export const unfollowRealWorldEvent = defineOperation({
  method: "DELETE",
  template: "/real-world-events/:realWorldEventId/follow",
  path: (args: { params: { realWorldEventId: string } }) =>
    `/real-world-events/${args.params.realWorldEventId}/follow`,
  response: z.null(),
});

/** Follow a place. */
export const followLocation = defineOperation({
  method: "POST",
  template: "/locations/:locationId/follow",
  path: (args: { params: { locationId: string } }) => `/locations/${args.params.locationId}/follow`,
  response: z.null(),
});

/** Stop following a place. */
export const unfollowLocation = defineOperation({
  method: "DELETE",
  template: "/locations/:locationId/follow",
  path: (args: { params: { locationId: string } }) => `/locations/${args.params.locationId}/follow`,
  response: z.null(),
});

/** Occasions this account follows. */
export const listFollowedRealWorldEvents = defineOperation({
  method: "GET",
  template: "/following/real-world-events",
  query: listFollowsRequestSchema,
  response: followedEventListSchema,
});

/** Places this account follows. */
export const listFollowedLocations = defineOperation({
  method: "GET",
  template: "/following/locations",
  query: listFollowsRequestSchema,
  response: followedLocationListSchema,
});

/** People this account follows. */
export const listFollowing = defineOperation({
  method: "GET",
  template: "/following",
  query: listFollowsRequestSchema,
  response: followListSchema,
});

/** People who follow this account. */
export const listFollowers = defineOperation({
  method: "GET",
  template: "/followers",
  query: listFollowsRequestSchema,
  response: followListSchema,
});

/** Follow requests waiting on this account. */
export const listFollowRequests = defineOperation({
  method: "GET",
  template: "/follow-requests",
  query: listFollowsRequestSchema,
  response: followRequestListSchema,
});

/** Let somebody follow. */
export const acceptFollowRequest = defineOperation({
  method: "POST",
  template: "/follow-requests/:requestId/accept",
  path: (args: { params: { requestId: string } }) =>
    `/follow-requests/${args.params.requestId}/accept`,
  response: z.null(),
});

/** Refuse a follow request. */
export const declineFollowRequest = defineOperation({
  method: "POST",
  template: "/follow-requests/:requestId/decline",
  path: (args: { params: { requestId: string } }) =>
    `/follow-requests/${args.params.requestId}/decline`,
  response: z.null(),
});

/** Withdraw a request you made. */
export const withdrawFollowRequest = defineOperation({
  method: "DELETE",
  template: "/follow-requests/:requestId",
  path: (args: { params: { requestId: string } }) => `/follow-requests/${args.params.requestId}`,
  response: z.null(),
});
