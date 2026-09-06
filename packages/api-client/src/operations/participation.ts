import {
  listParticipationsRequestSchema,
  momentParticipantsSchema,
  participationListSchema,
  participationRefusalListSchema,
  participationSchema,
  proposeParticipationSchema,
} from "@chronologity/contracts";
import { z } from "zod";
import { defineOperation } from "./operation.js";

/**
 * Saying somebody else was there.
 *
 * **Naming somebody is a proposal, not a fact.** It waits for them: an accepted
 * participation puts the Moment on their history, a rejected one does not, and
 * neither changes what the author recorded. A client showing a Moment's
 * participants must show pending ones as pending rather than as attendance.
 *
 * A refusal is standing rather than per-Moment — somebody who never wants to be
 * named by a particular person says so once.
 */

/** Propose that somebody was part of a Moment. */
export const proposeParticipation = defineOperation({
  method: "POST",
  template: "/moments/:momentId/participants",
  path: (args: { params: { momentId: string } }) => `/moments/${args.params.momentId}/participants`,
  body: proposeParticipationSchema,
  response: participationSchema,
});

/** Who has been named on a Moment, and where each stands. */
export const listMomentParticipants = defineOperation({
  method: "GET",
  template: "/moments/:momentId/participants",
  path: (args: { params: { momentId: string } }) => `/moments/${args.params.momentId}/participants`,
  response: momentParticipantsSchema,
});

/** Agree to being named. The Moment joins your history. */
export const acceptParticipation = defineOperation({
  method: "POST",
  template: "/participations/:participationId/accept",
  path: (args: { params: { participationId: string } }) =>
    `/participations/${args.params.participationId}/accept`,
  response: z.null(),
});

/** Decline being named. */
export const rejectParticipation = defineOperation({
  method: "POST",
  template: "/participations/:participationId/reject",
  path: (args: { params: { participationId: string } }) =>
    `/participations/${args.params.participationId}/reject`,
  response: z.null(),
});

/** Leave a Moment you had agreed to. */
export const leaveParticipation = defineOperation({
  method: "DELETE",
  template: "/participations/:participationId",
  path: (args: { params: { participationId: string } }) =>
    `/participations/${args.params.participationId}`,
  response: z.null(),
});

/** Participations involving this account, in either direction. */
export const listParticipations = defineOperation({
  method: "GET",
  template: "/participations",
  query: listParticipationsRequestSchema,
  response: participationListSchema,
});

/** People this account has refused to be named by. */
export const listParticipationRefusals = defineOperation({
  method: "GET",
  template: "/participation-refusals",
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(200).optional(),
  }),
  response: participationRefusalListSchema,
});

/** Refuse to be named by somebody, from now on. */
export const refuseParticipationFrom = defineOperation({
  method: "POST",
  template: "/users/:userId/participation-refusal",
  path: (args: { params: { userId: string } }) =>
    `/users/${args.params.userId}/participation-refusal`,
  response: z.null(),
});

/** Withdraw that refusal. */
export const allowParticipationFrom = defineOperation({
  method: "DELETE",
  template: "/users/:userId/participation-refusal",
  path: (args: { params: { userId: string } }) =>
    `/users/${args.params.userId}/participation-refusal`,
  response: z.null(),
});
