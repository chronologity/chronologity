import {
  identifierSchema,
  listParticipationsRequestSchema,
  momentParticipantsSchema,
  participationListSchema,
  participationRefusalListSchema,
  participationSchema,
  proposeParticipationSchema,
} from "@chronologity/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../../plugins/auth.plugin.js";
import { errors } from "../../server/error-responses.js";
import type { ParticipationService } from "./participation.service.js";

/**
 * Participation.
 *
 * A creator says somebody was part of a Moment; only that person may agree.
 * Until they do, the claim is a question between the two of them and is visible
 * to nobody else — not the Moment's audience, not the creator's followers, not
 * anybody reading the Moment.
 *
 * **Being named is not being admitted.** Nothing here grants sight of anything,
 * and a participant may be somebody who cannot read the Moment at all.
 *
 * @param participations - The service these routes delegate to.
 * @returns A Fastify plugin registering the participation endpoints.
 */
export function participationRoutes(participations: ParticipationService) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.addHook("onRoute", (route) => {
      route.schema = { ...route.schema, tags: ["Participation"] };
    });

    const momentParams = z.object({ momentId: identifierSchema });
    const participationParams = z.object({ participationId: identifierSchema });
    const userParams = z.object({ userId: identifierSchema });

    const silence = [
      "**A refusal is silent.** Somebody who has blocked you, or who has refused proposals from you, answers exactly as an account that does not exist. Refusing exists so a person can stop being asked, and telling the asker they were refused hands them what they need to ask another way.",
    ].join("\n");

    app.post(
      "/moments/:momentId/participants",
      {
        schema: {
          summary: "Say somebody was part of this Moment",
          description: [
            "Proposes participation. Only the Moment's creator may propose, and only the person named may establish it — until they answer, this asserts nothing and is visible to the two of you alone.",
            "",
            "**You may propose in a Moment they cannot read.** They are told who asked and when it happened, and nothing else: not the caption, not the media, not the place, not who else was there. Requiring you to admit somebody before asking them would make over-sharing the price of consent.",
            "",
            "A Moment names at most 100 people, counting unanswered proposals — a proposal holds its place.",
            "",
            silence,
          ].join("\n"),
          params: momentParams,
          body: proposeParticipationSchema,
          response: { 201: participationSchema, ...errors(400, 401, 404) },
        },
        preHandler: requireUser,
      },
      async (request, reply) =>
        reply
          .status(201)
          .send(
            await participations.propose(
              request.params.momentId,
              request.body.userId,
              request.user.userId,
            ),
          ),
    );

    app.get(
      "/moments/:momentId/participants",
      {
        schema: {
          summary: "Who this Moment records as having been there",
          description: [
            "People who confirmed they were part of it. Unanswered proposals are never listed here, whoever is asking: a proposal is a question between two people, and reaching it through the Moment would answer it for everybody else.",
            "",
            "Readable by anybody who may read the Moment, and by nobody who may not.",
          ].join("\n"),
          params: momentParams,
          response: { 200: momentParticipantsSchema, ...errors(400, 401, 404) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        participations.participants(request.params.momentId, request.user.userId),
    );

    app.post(
      "/participations/:participationId/accept",
      {
        schema: {
          summary: "Confirm you were there",
          description: [
            "Establishes the participation. Only the person named may do this.",
            "",
            "**Accepting grants you nothing.** If you could not read the Moment before, you still cannot. If you want to see it, ask its author — that decision is theirs and stays theirs.",
          ].join("\n"),
          params: participationParams,
          response: { 204: z.null(), ...errors(400, 401, 404) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await participations.answer(request.params.participationId, request.user.userId, "accepted");

        return reply.status(204).send(null);
      },
    );

    app.post(
      "/participations/:participationId/reject",
      {
        schema: {
          summary: "Say you were not part of this",
          description: [
            "Refuses the proposal, and refuses it permanently: the creator may never propose you for that Moment again.",
            "",
            "A refusal that can be repeated is not a refusal, it is a delay. Somebody asked again each week has no control, only a recurring task.",
            "",
            "The creator is told you refused, rather than left to wonder — somebody who cannot tell refusal from silence will ask again outside the product.",
          ].join("\n"),
          params: participationParams,
          response: { 204: z.null(), ...errors(400, 401, 404) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await participations.answer(request.params.participationId, request.user.userId, "rejected");

        return reply.status(204).send(null);
      },
    );

    app.delete(
      "/participations/:participationId",
      {
        schema: {
          summary: "Withdraw from a Moment, or take back a proposal",
          description: [
            "Two acts with the same verb, told apart by who is asking and what state the participation is in.",
            "",
            "**A participant withdraws** something they accepted, and that is permanent — the creator may never propose them for that Moment again, exactly as a refusal.",
            "",
            "**A creator takes back** a proposal nobody has answered. That is not a refusal, so it leaves nothing behind and they may ask again. A creator cannot remove a participation somebody accepted: that record belongs to the person who confirmed it, and the recourse is to delete the Moment.",
          ].join("\n"),
          params: participationParams,
          response: { 204: z.null(), ...errors(400, 401, 404) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await participations.remove(request.params.participationId, request.user.userId);

        return reply.status(204).send(null);
      },
    );

    app.get(
      "/participations",
      {
        schema: {
          summary: "Your participations",
          description: [
            "`to-me` lists what other people have said about you, which you may answer. `by-me` lists what you have said about others, which you may take back while it is unanswered.",
            "",
            "Two directions rather than one list, because they are different screens with different actions.",
          ].join("\n"),
          querystring: listParticipationsRequestSchema,
          response: { 200: participationListSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        participations.list(request.user.userId, {
          direction: request.query.direction,
          status: request.query.status,
          limit: request.query.limit,
          cursor: request.query.cursor,
        }),
    );

    app.get(
      "/participation-refusals",
      {
        schema: {
          summary: "Who you have refused",
          description:
            "Only your own, and only the direction you can act on. Who has refused **you** is not something this product will tell you, for the same reason a Block is never announced.",
          querystring: z.object({
            limit: z.coerce.number().int().min(1).max(100).default(50),
            cursor: z.string().max(200).optional(),
          }),
          response: { 200: participationRefusalListSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        participations.listRefusals(request.user.userId, {
          limit: request.query.limit,
          cursor: request.query.cursor,
        }),
    );

    app.post(
      "/users/:userId/participation-refusal",
      {
        schema: {
          summary: "Refuse participation proposals from somebody",
          description: [
            "Stops this person asking you to confirm you were anywhere. Weaker than a Block, which severs everything in both directions; this covers the ordinary case, where somebody is not blocked but is not welcome to keep asking.",
            "",
            "Participations you already accepted are untouched. A refusal governs what may be asked from here, not what you already agreed to.",
          ].join("\n"),
          params: userParams,
          response: { 204: z.null(), ...errors(400, 401, 404) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await participations.refuse(request.user.userId, request.params.userId);

        return reply.status(204).send(null);
      },
    );

    app.delete(
      "/users/:userId/participation-refusal",
      {
        schema: {
          summary: "Stop refusing somebody",
          description:
            "Lets them ask again from here. Restores nothing: proposals settled while the refusal stood stay settled, as a Block's severing does.",
          params: userParams,
          response: { 204: z.null(), ...errors(400, 401, 404) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await participations.allow(request.user.userId, request.params.userId);

        return reply.status(204).send(null);
      },
    );
  };
}
