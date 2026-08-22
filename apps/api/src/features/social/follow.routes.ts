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
    const userParams = z.object({ userId: identifierSchema });
    const requestParams = z.object({ requestId: identifierSchema });

    app.post(
      "/users/:userId/follow",
      {
        schema: { params: userParams, response: { 200: followOutcomeSchema } },
        preHandler: requireUser,
      },
      async (request) => follows.follow(request.user.userId, request.params.userId),
    );

    app.delete(
      "/users/:userId/follow",
      {
        schema: { params: userParams, response: { 204: z.null() } },
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
        schema: { params: userParams, response: { 204: z.null() } },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await follows.removeFollower(request.user.userId, request.params.userId);

        return reply.status(204).send(null);
      },
    );

    // Following a context rather than a person. No approval: an Event is shared
    // history and a Location is shared reference data, so there is nobody to
    // ask. An interface may present either as "follow this timeline".
    app.post(
      "/real-world-events/:realWorldEventId/follow",
      {
        schema: {
          params: z.object({ realWorldEventId: identifierSchema }),
          response: { 204: z.null() },
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
          params: z.object({ realWorldEventId: identifierSchema }),
          response: { 204: z.null() },
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
          params: z.object({ locationId: identifierSchema }),
          response: { 204: z.null() },
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
          params: z.object({ locationId: identifierSchema }),
          response: { 204: z.null() },
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
          querystring: listFollowsRequestSchema,
          response: { 200: followedEventListSchema },
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
          querystring: listFollowsRequestSchema,
          response: { 200: followedLocationListSchema },
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
        schema: { querystring: listFollowsRequestSchema, response: { 200: followListSchema } },
        preHandler: requireUser,
      },
      async (request) =>
        follows.list(request.user.userId, "following", request.query.limit, request.query.cursor),
    );

    app.get(
      "/followers",
      {
        schema: { querystring: listFollowsRequestSchema, response: { 200: followListSchema } },
        preHandler: requireUser,
      },
      async (request) =>
        follows.list(request.user.userId, "followers", request.query.limit, request.query.cursor),
    );

    app.get(
      "/follow-requests",
      {
        schema: {
          querystring: listFollowsRequestSchema,
          response: { 200: followRequestListSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        follows.listRequests(request.user.userId, request.query.limit, request.query.cursor),
    );

    app.post(
      "/follow-requests/:requestId/accept",
      {
        schema: { params: requestParams, response: { 204: z.null() } },
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
        schema: { params: requestParams, response: { 204: z.null() } },
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
        schema: { params: requestParams, response: { 204: z.null() } },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await follows.cancelRequest(request.params.requestId, request.user.userId);

        return reply.status(204).send(null);
      },
    );
  };
}
