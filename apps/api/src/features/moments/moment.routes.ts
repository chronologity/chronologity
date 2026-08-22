import {
  addMediaRequestSchema,
  correctOccurrenceRequestSchema,
  createMomentRequestSchema,
  reorderMediaRequestSchema,
  updateCaptionRequestSchema,
  identifierSchema,
  listMomentsRequestSchema,
  momentPageSchema,
  momentSchema,
} from "@chronologity/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../../plugins/auth.plugin.js";
import type { MomentService } from "./moment.service.js";

/**
 * Moment endpoints.
 *
 * Three, and every one of them is about the caller's own history. There is no
 * way to ask for somebody else's Moments, because there is nobody a Moment can
 * currently be shared with: every Moment is private to its author until the
 * social graph exists.
 *
 * Listing is bounded and continues by cursor rather than by offset, so a Moment
 * recorded while somebody is paging cannot cause another to be skipped or
 * repeated.
 *
 * @param moments - The service these routes delegate to.
 * @returns A Fastify plugin registering the Moment endpoints.
 */
export function momentRoutes(moments: MomentService) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.post(
      "/moments",
      {
        schema: { body: createMomentRequestSchema, response: { 201: momentSchema } },
        preHandler: requireUser,
      },
      async (request, reply) => {
        const moment = await moments.record(request.user.userId, request.body);

        return reply.status(201).send(moment);
      },
    );

    app.get(
      "/moments",
      {
        schema: { querystring: listMomentsRequestSchema, response: { 200: momentPageSchema } },
        preHandler: requireUser,
      },
      async (request) =>
        moments.list(request.user.userId, request.query.limit, request.query.cursor),
    );

    app.patch(
      "/moments/:momentId",
      {
        schema: {
          params: z.object({ momentId: identifierSchema }),
          body: updateCaptionRequestSchema,
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.updateCaption(request.params.momentId, request.user.userId, request.body.caption),
    );

    // Its own endpoint rather than part of the patch above, because correcting
    // when something happened is not the same act as fixing a typo: it moves
    // the Moment through chronology, and `moments.md:443` asks that the two not
    // be flattened into one.
    app.put(
      "/moments/:momentId/occurrence",
      {
        schema: {
          params: z.object({ momentId: identifierSchema }),
          body: correctOccurrenceRequestSchema,
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.correctOccurrence(
          request.params.momentId,
          request.user.userId,
          request.body.occurrence,
          request.body.occurrenceOffsetMinutes,
        ),
    );

    app.post(
      "/moments/:momentId/media",
      {
        schema: {
          params: z.object({ momentId: identifierSchema }),
          body: addMediaRequestSchema,
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.addMedia(request.params.momentId, request.user.userId, request.body.uploadIds),
    );

    app.put(
      "/moments/:momentId/media/order",
      {
        schema: {
          params: z.object({ momentId: identifierSchema }),
          body: reorderMediaRequestSchema,
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.reorderMedia(request.params.momentId, request.user.userId, request.body.uploadIds),
    );

    app.delete(
      "/moments/:momentId/media/:uploadId",
      {
        schema: {
          params: z.object({ momentId: identifierSchema, uploadId: identifierSchema }),
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.removeMedium(
          request.params.momentId,
          request.user.userId,
          request.params.uploadId,
        ),
    );

    app.delete(
      "/moments/:momentId",
      {
        schema: {
          params: z.object({ momentId: identifierSchema }),
          response: { 204: z.null() },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await moments.delete(request.params.momentId, request.user.userId);

        return reply.status(204).send(null);
      },
    );

    // Association is its own surface rather than a general update, because
    // these are historical claims rather than fields. Saying where something
    // happened and correcting a caption are not the same kind of act, and
    // `moments.md:407` asks that the difference not be flattened.
    app.put(
      "/moments/:momentId/location",
      {
        schema: {
          params: z.object({ momentId: identifierSchema }),
          body: z.object({ locationId: identifierSchema }),
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.setLocation(
          request.params.momentId,
          request.user.userId,
          request.body.locationId,
        ),
    );

    app.delete(
      "/moments/:momentId/location",
      {
        schema: {
          params: z.object({ momentId: identifierSchema }),
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) => moments.clearLocation(request.params.momentId, request.user.userId),
    );

    app.post(
      "/moments/:momentId/real-world-events",
      {
        schema: {
          params: z.object({ momentId: identifierSchema }),
          body: z.object({ realWorldEventId: identifierSchema }),
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.addRealWorldEvent(
          request.params.momentId,
          request.user.userId,
          request.body.realWorldEventId,
        ),
    );

    app.delete(
      "/moments/:momentId/real-world-events/:realWorldEventId",
      {
        schema: {
          params: z.object({
            momentId: identifierSchema,
            realWorldEventId: identifierSchema,
          }),
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.removeRealWorldEvent(
          request.params.momentId,
          request.user.userId,
          request.params.realWorldEventId,
        ),
    );

    app.get(
      "/moments/:momentId",
      {
        schema: {
          params: z.object({ momentId: identifierSchema }),
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) => moments.get(request.params.momentId, request.user.userId),
    );
  };
}
