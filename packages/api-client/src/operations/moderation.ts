import {
  accuracyReportPageSchema,
  accuracyReportSchema,
  appealPageSchema,
  appealSchema,
  decideAppealRequestSchema,
  listModerationRequestSchema,
  moderationReportPageSchema,
  moderationReportSchema,
  moderationSubjectStateSchema,
  ownModerationHistoryPageSchema,
  ownReportPageSchema,
  ownReportSchema,
  resolveReportRequestSchema,
  setModerationStateRequestSchema,
  setSuspensionRequestSchema,
  submitAccuracyReportRequestSchema,
  submitAppealRequestSchema,
  submitReportRequestSchema,
  suspensionSchema,
} from "@chronologity/contracts";
import { defineOperation } from "./operation.js";

/**
 * Reporting something, and reviewing what was reported.
 *
 * **Two sides of one glass, and a client must not confuse them.** The first
 * group is anybody's: what you reported, what happened to you, and appealing a
 * decision. The `/moderation/*` group is a reviewer's, guarded by a permission
 * this account may not hold — so a client shows those surfaces from
 * `getCapabilities`, and the server refuses regardless of what the client shows.
 *
 * There is no separate administrative application: this lives in the consumer
 * app behind server-enforced roles.
 *
 * **Two kinds of report, deliberately distinct.** A moderation report says
 * something breaks the rules; an accuracy report says something is *wrong* —
 * a date, a place, a claim about what happened. Chronologity is a record, so
 * being wrong is its own category rather than a kind of misbehaviour.
 */

/** Report something that breaks the rules. */
export const submitReport = defineOperation({
  method: "POST",
  template: "/reports",
  body: submitReportRequestSchema,
  response: ownReportSchema,
});

/** Reports this account has made. */
export const listOwnReports = defineOperation({
  method: "GET",
  template: "/reports",
  query: listModerationRequestSchema,
  response: ownReportPageSchema,
});

/** One report this account made. */
export const getOwnReport = defineOperation({
  method: "GET",
  template: "/reports/:reportId",
  path: (args: { params: { reportId: string } }) => `/reports/${args.params.reportId}`,
  response: ownReportSchema,
});

/** Report that something is factually wrong. */
export const submitAccuracyReport = defineOperation({
  method: "POST",
  template: "/accuracy-reports",
  body: submitAccuracyReportRequestSchema,
  response: accuracyReportSchema,
});

/** Accuracy reports this account has made. */
export const listOwnAccuracyReports = defineOperation({
  method: "GET",
  template: "/accuracy-reports",
  query: listModerationRequestSchema,
  response: accuracyReportPageSchema,
});

/** One accuracy report this account made. */
export const getOwnAccuracyReport = defineOperation({
  method: "GET",
  template: "/accuracy-reports/:reportId",
  path: (args: { params: { reportId: string } }) => `/accuracy-reports/${args.params.reportId}`,
  response: accuracyReportSchema,
});

/** What moderation has done to this account, and why. */
export const getOwnModerationHistory = defineOperation({
  method: "GET",
  template: "/me/moderation-history",
  query: listModerationRequestSchema,
  response: ownModerationHistoryPageSchema,
});

/** Appeal a decision. Permitted even while suspended. */
export const submitAppeal = defineOperation({
  method: "POST",
  template: "/appeals",
  body: submitAppealRequestSchema,
  response: appealSchema,
});

/** Appeals this account has made. */
export const listOwnAppeals = defineOperation({
  method: "GET",
  template: "/appeals",
  query: listModerationRequestSchema,
  response: appealPageSchema,
});

/** One appeal this account made. */
export const getOwnAppeal = defineOperation({
  method: "GET",
  template: "/appeals/:appealId",
  path: (args: { params: { appealId: string } }) => `/appeals/${args.params.appealId}`,
  response: appealSchema,
});

/** The review queue. Requires a moderation permission. */
export const listReportsForReview = defineOperation({
  method: "GET",
  template: "/moderation/reports",
  query: listModerationRequestSchema,
  response: moderationReportPageSchema,
});

/** One report, as a reviewer sees it. */
export const getReportForReview = defineOperation({
  method: "GET",
  template: "/moderation/reports/:reportId",
  path: (args: { params: { reportId: string } }) => `/moderation/reports/${args.params.reportId}`,
  response: moderationReportSchema,
});

/** Decide a report. */
export const resolveReport = defineOperation({
  method: "PUT",
  template: "/moderation/reports/:reportId",
  path: (args: { params: { reportId: string } }) => `/moderation/reports/${args.params.reportId}`,
  body: resolveReportRequestSchema,
  response: moderationReportSchema,
});

/** The accuracy queue. */
export const listAccuracyReportsForReview = defineOperation({
  method: "GET",
  template: "/moderation/accuracy-reports",
  query: listModerationRequestSchema,
  response: accuracyReportPageSchema,
});

/** One accuracy report, as a reviewer sees it. */
export const getAccuracyReportForReview = defineOperation({
  method: "GET",
  template: "/moderation/accuracy-reports/:reportId",
  path: (args: { params: { reportId: string } }) =>
    `/moderation/accuracy-reports/${args.params.reportId}`,
  response: accuracyReportSchema,
});

/** Decide an accuracy report. */
export const resolveAccuracyReport = defineOperation({
  method: "PUT",
  template: "/moderation/accuracy-reports/:reportId",
  path: (args: { params: { reportId: string } }) =>
    `/moderation/accuracy-reports/${args.params.reportId}`,
  body: resolveReportRequestSchema,
  response: accuracyReportSchema,
});

/** Withhold or release something. */
export const setModerationState = defineOperation({
  method: "PUT",
  template: "/moderation/subjects/:subjectType/:subjectId/state",
  path: (args: { params: { subjectType: string; subjectId: string } }) =>
    `/moderation/subjects/${args.params.subjectType}/${args.params.subjectId}/state`,
  body: setModerationStateRequestSchema,
  response: moderationSubjectStateSchema,
});

/** Suspend an account, or lift a suspension. */
export const setSuspension = defineOperation({
  method: "PUT",
  template: "/users/:userId/suspension",
  path: (args: { params: { userId: string } }) => `/users/${args.params.userId}/suspension`,
  body: setSuspensionRequestSchema,
  response: suspensionSchema,
});

/** The appeal queue. */
export const listAppealsForReview = defineOperation({
  method: "GET",
  template: "/moderation/appeals",
  query: listModerationRequestSchema,
  response: appealPageSchema,
});

/** One appeal, as a reviewer sees it. */
export const getAppealForReview = defineOperation({
  method: "GET",
  template: "/moderation/appeals/:appealId",
  path: (args: { params: { appealId: string } }) => `/moderation/appeals/${args.params.appealId}`,
  response: appealSchema,
});

/** Decide an appeal. */
export const decideAppeal = defineOperation({
  method: "PUT",
  template: "/moderation/appeals/:appealId",
  path: (args: { params: { appealId: string } }) => `/moderation/appeals/${args.params.appealId}`,
  body: decideAppealRequestSchema,
  response: appealSchema,
});
