import {
  createSavedViewRequestSchema,
  createShareRequestSchema,
  renameSavedViewRequestSchema,
  savedViewListSchema,
  savedViewSchema,
  savedViewShareListSchema,
  savedViewShareSchema,
  sharedViewSchema,
} from "@chronologity/contracts";
import { z } from "zod";
import { defineOperation } from "./operation.js";

/**
 * Keeping a perspective, and handing it to somebody.
 *
 * A saved view is a description — a context, a stretch of time, a lens — and
 * never any history. **Sharing one hands over the description, not the
 * Moments**: the recipient then reads it as themselves, which is what stops a
 * link ever showing somebody something they could not otherwise open. A client
 * must not expect a share to carry entries, and must read the view through the
 * Timeline afterwards.
 */

/** Keep the view somebody is looking at. */
export const createSavedView = defineOperation({
  method: "POST",
  template: "/saved-views",
  body: createSavedViewRequestSchema,
  response: savedViewSchema,
});

/** Views this account has kept. */
export const listSavedViews = defineOperation({
  method: "GET",
  template: "/saved-views",
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(200).optional(),
  }),
  response: savedViewListSchema,
});

/** One kept view. */
export const getSavedView = defineOperation({
  method: "GET",
  template: "/saved-views/:savedViewId",
  path: (args: { params: { savedViewId: string } }) => `/saved-views/${args.params.savedViewId}`,
  response: savedViewSchema,
});

/** Rename a kept view. */
export const renameSavedView = defineOperation({
  method: "PATCH",
  template: "/saved-views/:savedViewId",
  path: (args: { params: { savedViewId: string } }) => `/saved-views/${args.params.savedViewId}`,
  body: renameSavedViewRequestSchema,
  response: savedViewSchema,
});

/** Forget a kept view. */
export const deleteSavedView = defineOperation({
  method: "DELETE",
  template: "/saved-views/:savedViewId",
  path: (args: { params: { savedViewId: string } }) => `/saved-views/${args.params.savedViewId}`,
  response: z.null(),
});

/** Hear when a view has more in it. */
export const followSavedView = defineOperation({
  method: "PUT",
  template: "/saved-views/:savedViewId/following",
  path: (args: { params: { savedViewId: string } }) =>
    `/saved-views/${args.params.savedViewId}/following`,
  response: z.null(),
});

/** Stop hearing about it. */
export const unfollowSavedView = defineOperation({
  method: "DELETE",
  template: "/saved-views/:savedViewId/following",
  path: (args: { params: { savedViewId: string } }) =>
    `/saved-views/${args.params.savedViewId}/following`,
  response: z.null(),
});

/** Record that this view has been looked at, so "new since" means something. */
export const recordSavedViewVisit = defineOperation({
  method: "POST",
  template: "/saved-views/:savedViewId/visits",
  path: (args: { params: { savedViewId: string } }) =>
    `/saved-views/${args.params.savedViewId}/visits`,
  response: z.null(),
});

/** Make a link somebody else can open. */
export const createShare = defineOperation({
  method: "POST",
  template: "/saved-views/:savedViewId/shares",
  path: (args: { params: { savedViewId: string } }) =>
    `/saved-views/${args.params.savedViewId}/shares`,
  body: createShareRequestSchema,
  response: savedViewShareSchema,
});

/** Links made for this view. */
export const listShares = defineOperation({
  method: "GET",
  template: "/saved-views/:savedViewId/shares",
  path: (args: { params: { savedViewId: string } }) =>
    `/saved-views/${args.params.savedViewId}/shares`,
  response: savedViewShareListSchema,
});

/** Revoke a link. */
export const deleteShare = defineOperation({
  method: "DELETE",
  template: "/shares/:shareId",
  path: (args: { params: { shareId: string } }) => `/shares/${args.params.shareId}`,
  response: z.null(),
});

/**
 * Open a link somebody sent.
 *
 * Returns the view and no history. Requires a credential even though the token
 * is what authorises: a link is a capability rather than a public address, and
 * requiring a session means an anonymous crawler cannot walk the token space.
 */
export const openSharedView = defineOperation({
  method: "GET",
  template: "/shared-views/:token",
  path: (args: { params: { token: string } }) => `/shared-views/${args.params.token}`,
  response: sharedViewSchema,
});
