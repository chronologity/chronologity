import {
  createMomentRequestSchema,
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
