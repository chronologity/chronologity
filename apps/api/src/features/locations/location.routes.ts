import {
  createLocationRequestSchema,
  identifierSchema,
  locationSchema,
  placeSuggestionsSchema,
  searchPlacesRequestSchema,
} from "@chronologity/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../../plugins/auth.plugin.js";
import { errors } from "../../server/error-responses.js";
import type { LocationService } from "./location.service.js";

/**
 * Location endpoints.
 *
 * Searching is separate from recording on purpose. A search returns candidates
 * from a map service and creates nothing; a place exists in Chronologity only
 * when someone chooses one, and then it carries an identity of ours rather
 * than the service's.
 *
 * @param locations - The service these routes delegate to.
 * @returns A Fastify plugin registering the Location endpoints.
 */
export function locationRoutes(locations: LocationService) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    // Every route this module registers, grouped under one heading in the
    // published document. A hook rather than a line on each route: a route
    // added later is grouped without anybody remembering to say so.
    app.addHook("onRoute", (route) => {
      route.schema = { ...route.schema, tags: ["Locations"] };
    });

    app.get(
      "/places/search",
      {
        schema: {
          summary: "Search for a place",
          description:
            "Asks the map service for candidates. Nothing here exists in Chronologity yet — a suggestion becomes a Location only when somebody records one from it, and the name it is recorded with is kept forever rather than re-fetched later.",
          querystring: searchPlacesRequestSchema,
          response: { 200: placeSuggestionsSchema, ...errors(400, 401, 403) },
        },
        preHandler: requireUser,
      },
      async (request) => locations.searchPlaces(request.query.query, request.query.limit),
    );

    app.post(
      "/locations",
      {
        schema: {
          summary: "Record a place",
          description:
            "Recording the same map result twice reaches the same Location rather than creating a second one. A Location is shared reference data: recording it is provenance, not ownership, and anybody's Moment may point at it.",
          body: createLocationRequestSchema,
          response: { 201: locationSchema, ...errors(400, 401, 403) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        const location = await locations.record(request.user.userId, request.body);

        return reply.status(201).send(location);
      },
    );

    app.get(
      "/locations/:locationId",
      {
        schema: {
          summary: "Read a place",
          params: z.object({ locationId: identifierSchema }),
          response: { 200: locationSchema, ...errors(401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request) => locations.get(request.params.locationId),
    );
  };
}
