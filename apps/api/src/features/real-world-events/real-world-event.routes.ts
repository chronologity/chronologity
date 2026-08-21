import {
  createRealWorldEventRequestSchema,
  identifierSchema,
  realWorldEventSchema,
} from "@chronologity/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../../plugins/auth.plugin.js";
import type { RealWorldEventService } from "./real-world-event.service.js";

/**
 * Real-world Event endpoints.
 *
 * Two, deliberately: record one, and read one by identifier.
 *
 * There is no listing, no search, and no discovery. Those are the privacy
 * surface — `real-world-events.md:732-752` is explicit that an Event's
 * existence can itself be sensitive, and that Event aggregation must not
 * become a privacy bypass. Nothing enumerates Events until who may see one has
 * been decided, which is the same position ADR-098 took for Locations.
 *
 * @param events - The service these routes delegate to.
 * @returns A Fastify plugin registering the real-world Event endpoints.
 */
export function realWorldEventRoutes(events: RealWorldEventService) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.post(
      "/real-world-events",
      {
        schema: {
          body: createRealWorldEventRequestSchema,
          response: { 201: realWorldEventSchema },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        const event = await events.record(request.user.userId, request.body);

        return reply.status(201).send(event);
      },
    );

    app.get(
      "/real-world-events/:realWorldEventId",
      {
        schema: {
          params: z.object({ realWorldEventId: identifierSchema }),
          response: { 200: realWorldEventSchema },
        },
        preHandler: requireUser,
      },
      async (request) => events.get(request.params.realWorldEventId),
    );
  };
}
