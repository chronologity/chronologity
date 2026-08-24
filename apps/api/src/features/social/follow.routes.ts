import {
  followedEventListSchema,
  followedLocationListSchema,
  followListSchema,
  followOutcomeSchema,
  followRequestListSchema,
  identifierSchema,
  listFollowsRequestSchema,
} from "@chronologity/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../../plugins/auth.plugin.js";
import { errors } from "../../server/error-responses.js";
import type { FollowService } from "./follow.service.js";

/**
 * Following endpoints.
 *
 * Every one is about the caller's own relationships. Nothing exposes whose
 * followers are whose: who may see another person's follower list is four
 * separate open questions, and answering them by shipping an endpoint would be
 * answering them by implementation.
 *
 * The follow endpoints are nested under the person being followed, so the URL
 * says which kind of following it is. Following a historical context, when it
 * arrives, will read differently and should.
 *
 * @param follows - The service these routes delegate to.
 * @returns A Fastify plugin registering the following endpoints.
 */
export function followRoutes(follows: FollowService) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    // Every route this module registers, grouped under one heading in the
    // published document. A hook rather than a line on each route: a route
    // added later is grouped without anybody remembering to say so.
    app.addHook("onRoute", (route) => {
      route.schema = { ...route.schema, tags: ["Social"] };
    });
    const userParams = z.object({ userId: identifierSchema });
    const requestParams = z.object({ requestId: identifierSchema });

    app.post(
      "/users/:userId/follow",
      {
        schema: {
          summary: "Follow somebody, or ask to",
          description:
            "The answer says which happened, so nothing has to expose in advance whether an account requires approval. Following somebody you already follow succeeds: you asked for a state that already holds. An account that has blocked you answers as though it does not exist.", params: userParams, response: { 200: followOutcomeSchema, ...errors(400, 401, 403, 404) } },
        preHandler: requireUser,
      },
      async (request) => follows.follow(request.user.userId, request.params.userId),
    );

    app.delete(
      "/users/:userId/follow",
      {
        schema: {
          summary: "Stop following somebody",
          description:
            "Unfollowing somebody you never followed is not an error.", params: userParams, response: { 204: z.null(), ...errors(401, 403) } },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await follows.unfollow(request.user.userId, request.params.userId);

        return reply.status(204).send(null);
      },
    );

    // Ending the same relationship from the other side. Its own endpoint
    // because losing interest and withdrawing an audience are different acts.
    app.delete(
      "/followers/:userId",
      {
        schema: {
          summary: "Remove one of your followers",
          description:
            "The same relationship as unfollowing, ended from the other side. Kept separate because they are different acts: one is losing interest, the other is withdrawing an audience.", params: userParams, response: { 204: z.null(), ...errors(401, 403) } },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await follows.removeFollower(request.user.userId, request.params.userId);

        return reply.status(204).send(null);
      },
    );

    app.post(
      "/users/:userId/block",
      {
        schema: {
          summary: "Block somebody",
          description:
            "One act: the block is recorded, any follow in either direction is removed, and any pending request between you is cancelled. Nothing tells the other person. Blocking somebody already blocked is the state already holding.", params: userParams, response: { 204: z.null(), ...errors(400, 401, 403, 404) } },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await follows.block(request.user.userId, request.params.userId);

        return reply.status(204).send(null);
      },
    );

    app.delete(
      "/users/:userId/block",
      {
        schema: {
          summary: "Unblock somebody",
          description:
            "Restores nothing. What the block severed stays severed, and either of you may follow again from scratch.", params: userParams, response: { 204: z.null(), ...errors(401, 403) } },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await follows.unblock(request.user.userId, request.params.userId);

        return reply.status(204).send(null);
      },
    );

    // Only the direction the caller can act on. Who has blocked them is
    // deliberately unreadable: the product must not tell anybody they have been
    // blocked.
    app.get(
      "/blocks",
      {
        schema: {
          summary: "List who you have blocked",
          description:
            "Only the direction you can act on. There is no way to learn who has blocked you, because the product must not tell anybody that.", querystring: listFollowsRequestSchema, response: { 200: followListSchema, ...errors(400, 401, 403) } },
        preHandler: requireUser,
      },
      async (request) =>
        follows.listBlocked(request.user.userId, request.query.limit, request.query.cursor),
    );

    // Following a context rather than a person. No approval: an Event is shared
    // history and a Location is shared reference data, so there is nobody to
    // ask. An interface may present either as "follow this timeline".
    app.post(
      "/real-world-events/:realWorldEventId/follow",
      {
        schema: {
          summary: "Follow a real-world Event",
          description:
            "No approval: an Event is shared history, so there is nobody to ask. Following grants no access to anything — it says what you want to hear about, never what you may see.",
          params: z.object({ realWorldEventId: identifierSchema }),
          response: { 204: z.null(), ...errors(401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await follows.followContext(
          request.user.userId,
          "real-world-event",
          request.params.realWorldEventId,
        );

        return reply.status(204).send(null);
      },
    );

    app.delete(
      "/real-world-events/:realWorldEventId/follow",
      {
        schema: {
          summary: "Stop following an Event",
          params: z.object({ realWorldEventId: identifierSchema }),
          response: { 204: z.null(), ...errors(401, 403) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await follows.unfollowContext(
          request.user.userId,
          "real-world-event",
          request.params.realWorldEventId,
        );

        return reply.status(204).send(null);
      },
    );

    app.post(
      "/locations/:locationId/follow",
      {
        schema: {
          summary: "Follow a place",
          description:
            "No approval: a Location is shared reference data. An interface may present this as following a timeline.",
          params: z.object({ locationId: identifierSchema }),
          response: { 204: z.null(), ...errors(401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await follows.followContext(request.user.userId, "location", request.params.locationId);

        return reply.status(204).send(null);
      },
    );

    app.delete(
      "/locations/:locationId/follow",
      {
        schema: {
          summary: "Stop following a place",
          params: z.object({ locationId: identifierSchema }),
          response: { 204: z.null(), ...errors(401, 403) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await follows.unfollowContext(request.user.userId, "location", request.params.locationId);

        return reply.status(204).send(null);
      },
    );

    app.get(
      "/following/real-world-events",
      {
        schema: {
          summary: "List the Events you follow",
          querystring: listFollowsRequestSchema,
          response: { 200: followedEventListSchema, ...errors(400, 401, 403) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        follows.listFollowedEvents(request.user.userId, request.query.limit, request.query.cursor),
    );

    app.get(
      "/following/locations",
      {
        schema: {
          summary: "List the places you follow",
          querystring: listFollowsRequestSchema,
          response: { 200: followedLocationListSchema, ...errors(400, 401, 403) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        follows.listFollowedLocations(
          request.user.userId,
          request.query.limit,
          request.query.cursor,
        ),
    );

    app.get(
      "/following",
      {
        schema: {
          summary: "List who you follow",
          description:
            "Paged by cursor. The cursor is opaque: it encodes where the ordering continues from, and taking it apart will break when the ordering changes.", querystring: listFollowsRequestSchema, response: { 200: followListSchema, ...errors(400, 401, 403) } },
        preHandler: requireUser,
      },
      async (request) =>
        follows.list(request.user.userId, "following", request.query.limit, request.query.cursor),
    );

    app.get(
      "/followers",
      {
        schema: {
          summary: "List who follows you", querystring: listFollowsRequestSchema, response: { 200: followListSchema, ...errors(400, 401, 403) } },
        preHandler: requireUser,
      },
      async (request) =>
        follows.list(request.user.userId, "followers", request.query.limit, request.query.cursor),
    );

    app.get(
      "/follow-requests",
      {
        schema: {
          summary: "List requests waiting on you",
          querystring: listFollowsRequestSchema,
          response: { 200: followRequestListSchema, ...errors(400, 401, 403) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        follows.listRequests(request.user.userId, request.query.limit, request.query.cursor),
    );

    app.post(
      "/follow-requests/:requestId/accept",
      {
        schema: {
          summary: "Accept a request",
          description:
            "Creates the follow and settles the request together.", params: requestParams, response: { 204: z.null(), ...errors(400, 401, 403, 404) } },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await follows.answerRequest(request.params.requestId, request.user.userId, "accepted");

        return reply.status(204).send(null);
      },
    );

    app.post(
      "/follow-requests/:requestId/decline",
      {
        schema: {
          summary: "Decline a request",
          description:
            "Kept rather than deleted, so what was asked and refused survives.", params: requestParams, response: { 204: z.null(), ...errors(400, 401, 403, 404) } },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await follows.answerRequest(request.params.requestId, request.user.userId, "declined");

        return reply.status(204).send(null);
      },
    );

    app.delete(
      "/follow-requests/:requestId",
      {
        schema: {
          summary: "Withdraw a request you made", params: requestParams, response: { 204: z.null(), ...errors(401, 403, 404) } },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await follows.cancelRequest(request.params.requestId, request.user.userId);

        return reply.status(204).send(null);
      },
    );
  };
}
