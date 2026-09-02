import {
  accuracyReportPageSchema,
  accuracyReportSchema,
  appealPageSchema,
  appealSchema,
  decideAppealRequestSchema,
  identifierSchema,
  listModerationRequestSchema,
  moderationReportPageSchema,
  moderationReportSchema,
  moderationSubjectStateSchema,
  moderationSubjectTypeSchema,
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
import type { Permission } from "@chronologity/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { UnauthorizedError } from "../../lib/errors/unauthorized-error.js";
import { requirePermission, requireUser } from "../../plugins/auth.plugin.js";
import { errors } from "../../server/error-responses.js";
import { hasPermission } from "../authorization/authorization.policy.js";
import type { ModerationService } from "./moderation.service.js";

const reportParams = z.object({ reportId: identifierSchema });
const appealParams = z.object({ appealId: identifierSchema });
const subjectParams = z.object({
  subjectType: moderationSubjectTypeSchema,
  subjectId: identifierSchema,
});
const userParams = z.object({ userId: identifierSchema });

/**
 * Moderation endpoints.
 *
 * Split by who they are for, and the split is in the path. Everything under
 * `/moderation` requires a moderator capability, without exception: a
 * self-serve route inside that prefix is the kind of exception a future blanket
 * guard gets wrong in whichever direction it guesses. What a person may do
 * about their own reports, appeals, and history sits outside it.
 *
 * Reporting is open to anybody signed in. Deciding is not, and the two never
 * meet: `moderation.md:614` says report volume "may affect review
 * prioritization" and must never establish that content violates policy, so
 * nothing a reporter does reaches a state.
 *
 * @param moderation - The service these routes delegate to.
 * @returns A Fastify plugin registering the moderation endpoints.
 */
export function moderationRoutes(moderation: ModerationService) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.addHook("onRoute", (route) => {
      route.schema = { ...route.schema, tags: ["Moderation"] };
    });

    /**
     * A guard that leaves evidence when it refuses.
     *
     * `requirePermission` throws before a handler runs, which is right and
     * means the service never learns the attempt happened. For routes that name
     * a subject, that silence loses exactly what a later review would want: who
     * tried to moderate whom. This records the attempt and then refuses
     * identically.
     *
     * @param permission - What the route requires.
     * @param subjectOf - Where the subject is in the request.
     * @returns A preHandler that authenticates, checks the permission, and
     *   writes a refusal down before refusing.
     */
    function guardRecording(
      permission: Permission,
      subjectOf: (request: FastifyRequest) => { type: string; id: string },
    ) {
      return async function guard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
        await requireUser(request, reply);

        const roles = await request.server.readRoles(request.user.userId);

        if (hasPermission(roles, permission)) {
          return;
        }

        const subject = subjectOf(request);

        await moderation.recordRefusal(
          subject.type,
          subject.id,
          request.user.userId,
          `Attempted ${permission} without holding it`,
        );

        throw new UnauthorizedError("You do not have permission to do that");
      };
    }

    app.post(
      "/reports",
      {
        schema: {
          summary: "Report something",
          description:
            "Available to anybody signed in. A report changes nothing by itself: report volume may affect how soon a moderator looks, and never establishes that anything broke a rule. The person reported is never told who reported them. Reporting the same thing twice returns the report already filed rather than failing.",
          body: submitReportRequestSchema,
          response: { 201: ownReportSchema, ...errors(400, 401, 404) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        const report = await moderation.report(request.user.userId, request.body);

        return reply.code(201).send(report);
      },
    );

    app.get(
      "/reports",
      {
        schema: {
          summary: "Reports you filed",
          description:
            "Your own reports and where each has got to. Carries no reviewer identity, no internal detail, and nothing about the person reported.",
          querystring: listModerationRequestSchema,
          response: { 200: ownReportPageSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moderation.listOwnReports(
          request.user.userId,
          request.query.limit,
          request.query.cursor,
        ),
    );

    app.get(
      "/reports/:reportId",
      {
        schema: {
          summary: "One report you filed",
          description:
            "Status only. A report somebody else filed is reported as absent rather than forbidden: that a report exists about a given subject is itself something you are not entitled to learn.",
          params: reportParams,
          response: { 200: ownReportSchema, ...errors(401, 404) },
        },
        preHandler: requireUser,
      },
      async (request) => moderation.getOwnReport(request.params.reportId, request.user.userId),
    );

    app.post(
      "/accuracy-reports",
      {
        schema: {
          summary: "Report a historical inaccuracy",
          description:
            "A separate path from safety reporting, and a separate queue. Saying a Moment happened in 2004 rather than 2005 is a correction; saying it threatens you is not. Nothing filed here can reach a moderation state.",
          body: submitAccuracyReportRequestSchema,
          response: { 201: accuracyReportSchema, ...errors(400, 401, 404) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        const report = await moderation.reportAccuracy(request.user.userId, request.body);

        return reply.code(201).send(report);
      },
    );

    app.get(
      "/accuracy-reports",
      {
        schema: {
          summary: "Accuracy reports you filed",
          description: "Your own historical-accuracy reports and where each has got to.",
          querystring: listModerationRequestSchema,
          response: { 200: accuracyReportPageSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moderation.listOwnAccuracyReports(
          request.user.userId,
          request.query.limit,
          request.query.cursor,
        ),
    );

    app.get(
      "/accuracy-reports/:reportId",
      {
        schema: {
          summary: "One accuracy report you filed",
          params: reportParams,
          response: { 200: accuracyReportSchema, ...errors(401, 404) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moderation.getOwnAccuracyReport(request.params.reportId, request.user.userId),
    );

    app.get(
      "/me/moderation-history",
      {
        schema: {
          summary: "What was done to your content",
          description:
            "Every moderation decision taken against your own content, with the reason and whether you have appealed it. This is what makes an appeal possible: nobody can contest a decision they were never told about. Attempts that were refused are not listed — those are evidence for a security review rather than something that happened to you.",
          querystring: listModerationRequestSchema,
          response: { 200: ownModerationHistoryPageSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moderation.ownHistory(request.user.userId, request.query.limit, request.query.cursor),
    );

    app.post(
      "/appeals",
      {
        schema: {
          summary: "Contest a decision",
          description:
            "Appeal a moderation decision taken against you. Available while suspended, since an enforcement system somebody cannot answer is not one. A decision already under appeal is refused rather than silently ignored, because an appeal carries a statement you wrote.",
          body: submitAppealRequestSchema,
          response: { 201: appealSchema, ...errors(400, 401, 404) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        const appeal = await moderation.appeal(request.user.userId, request.body);

        return reply.code(201).send(appeal);
      },
    );

    app.get(
      "/appeals",
      {
        schema: {
          summary: "Appeals you filed",
          querystring: listModerationRequestSchema,
          response: { 200: appealPageSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moderation.listOwnAppeals(
          request.user.userId,
          request.query.limit,
          request.query.cursor,
        ),
    );

    app.get(
      "/appeals/:appealId",
      {
        schema: {
          summary: "One appeal you filed",
          description: "Outcome included once there is one. Somebody else's appeal reads as absent.",
          params: appealParams,
          response: { 200: appealSchema, ...errors(401, 404) },
        },
        preHandler: requireUser,
      },
      async (request) => moderation.getOwnAppeal(request.params.appealId, request.user.userId),
    );

    app.get(
      "/moderation/reports",
      {
        schema: {
          summary: "The safety queue",
          description:
            "Requires `moderation:report-review`. Oldest first, so nothing waits indefinitely behind newer arrivals. Each report carries how many separate people reported the subject and whether they arrived together — both to inform a reviewer, neither to decide anything.",
          querystring: listModerationRequestSchema,
          response: { 200: moderationReportPageSchema, ...errors(400, 401, 403) },
        },
        preHandler: requirePermission("moderation:report-review"),
      },
      async (request) => moderation.listQueue(request.query.limit, request.query.cursor),
    );

    app.get(
      "/moderation/reports/:reportId",
      {
        schema: {
          summary: "One report, whole",
          description: "Requires `moderation:report-review`. Carries the reporter, which the subject never receives.",
          params: reportParams,
          response: { 200: moderationReportSchema, ...errors(401, 403, 404) },
        },
        preHandler: requirePermission("moderation:report-review"),
      },
      async (request) => moderation.getReport(request.params.reportId),
    );

    app.put(
      "/moderation/reports/:reportId",
      {
        schema: {
          summary: "Move a report through its status",
          description:
            "Requires `moderation:report-review`. Deciding a report and moderating its subject are separate acts: a report can be closed with nothing done, because no violation is a real outcome. Resolved and closed are terminal.",
          params: reportParams,
          body: resolveReportRequestSchema,
          response: { 200: moderationReportSchema, ...errors(400, 401, 403, 404) },
        },
        preHandler: requirePermission("moderation:report-review"),
      },
      async (request) => moderation.transitionReport(request.params.reportId, request.body.status),
    );

    app.get(
      "/moderation/accuracy-reports",
      {
        schema: {
          summary: "The accuracy queue",
          description:
            "Requires `moderation:report-review`. Holds no safety reports: they live in a different table, so the separation is structural rather than a filter somebody could forget.",
          querystring: listModerationRequestSchema,
          response: { 200: accuracyReportPageSchema, ...errors(400, 401, 403) },
        },
        preHandler: requirePermission("moderation:report-review"),
      },
      async (request) => moderation.listAccuracyQueue(request.query.limit, request.query.cursor),
    );

    app.get(
      "/moderation/accuracy-reports/:reportId",
      {
        schema: {
          summary: "One accuracy report",
          params: reportParams,
          response: { 200: accuracyReportSchema, ...errors(401, 403, 404) },
        },
        preHandler: requirePermission("moderation:report-review"),
      },
      async (request) => moderation.getAccuracyReport(request.params.reportId),
    );

    app.put(
      "/moderation/accuracy-reports/:reportId",
      {
        schema: {
          summary: "Resolve an accuracy report",
          description:
            "Requires `moderation:report-review`. Reaches no moderation state: a wrong date is something to fix, not something to enforce against, and the correction itself belongs to the Moment's author.",
          params: reportParams,
          body: resolveReportRequestSchema,
          response: { 200: accuracyReportSchema, ...errors(400, 401, 403, 404) },
        },
        preHandler: requirePermission("moderation:report-review"),
      },
      async (request) =>
        moderation.transitionAccuracyReport(request.params.reportId, request.body.status),
    );

    app.put(
      "/moderation/subjects/:subjectType/:subjectId/state",
      {
        schema: {
          summary: "Set a moderation state",
          description:
            "Requires `moderation:content-moderate`. Decides what Chronologity distributes, never what happened: occurrence, authorship, and position in chronology are untouched, the author keeps reading their own, and nothing is deleted. Setting `allowed` clears the state. Moderating a Moment's last remaining medium makes the Moment itself unavailable, because a Moment without media could not have been created. An attempt by somebody without the permission is recorded before it is refused.",
          params: subjectParams,
          body: setModerationStateRequestSchema,
          response: { 200: moderationSubjectStateSchema, ...errors(400, 401, 403, 404) },
        },
        preHandler: guardRecording("moderation:content-moderate", (request) => {
          const params = request.params as z.infer<typeof subjectParams>;

          return { type: params.subjectType, id: params.subjectId };
        }),
      },
      async (request) =>
        moderation.setState(
          request.params.subjectType,
          request.params.subjectId,
          request.body,
          { userId: request.user.userId },
        ),
    );

    app.put(
      "/users/:userId/suspension",
      {
        schema: {
          summary: "Suspend or reinstate an account",
          description:
            "Requires `moderation:account-suspend`. Hides what the account contributed and deletes none of it: follows, blocks, relationships, Moments, and comments all survive, because the account may come back. The suspended person keeps reading their own history and may appeal. An attempt by somebody without the permission is recorded before it is refused.",
          params: userParams,
          body: setSuspensionRequestSchema,
          response: { 200: suspensionSchema, ...errors(400, 401, 403, 404) },
        },
        preHandler: guardRecording("moderation:account-suspend", (request) => ({
          type: "user",
          id: (request.params as z.infer<typeof userParams>).userId,
        })),
      },
      async (request) =>
        moderation.setSuspension(
          request.params.userId,
          request.body.suspended,
          request.body.reason,
          { userId: request.user.userId },
        ),
    );

    app.get(
      "/moderation/appeals",
      {
        schema: {
          summary: "The appeal queue",
          description: "Requires `moderation:appeal-review`. Oldest first.",
          querystring: listModerationRequestSchema,
          response: { 200: appealPageSchema, ...errors(400, 401, 403) },
        },
        preHandler: requirePermission("moderation:appeal-review"),
      },
      async (request) => moderation.listAppealQueue(request.query.limit, request.query.cursor),
    );

    app.get(
      "/moderation/appeals/:appealId",
      {
        schema: {
          summary: "One appeal, whole",
          params: appealParams,
          response: { 200: appealSchema, ...errors(401, 403, 404) },
        },
        preHandler: requirePermission("moderation:appeal-review"),
      },
      async (request) => moderation.getAppeal(request.params.appealId),
    );

    app.put(
      "/moderation/appeals/:appealId",
      {
        schema: {
          summary: "Uphold or reverse an appeal",
          description:
            "Requires `moderation:appeal-review`. Reversing restores what the action restricted — which is possible only because moderation hid things rather than destroying them.",
          params: appealParams,
          body: decideAppealRequestSchema,
          response: { 200: appealSchema, ...errors(400, 401, 403, 404) },
        },
        preHandler: requirePermission("moderation:appeal-review"),
      },
      async (request) =>
        moderation.decideAppeal(request.params.appealId, request.body, {
          userId: request.user.userId,
        }),
    );
  };
}
