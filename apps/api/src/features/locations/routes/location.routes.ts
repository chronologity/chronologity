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
import { requireUser } from "../../../plugins/auth.plugin.js";
import { recordLocationCommand } from "../commands/record-location.command.js";
import { handleRecordLocation } from "../commands/record-location.handler.js";
import type { LocationDependencies } from "../dependencies.js";
import { handleGetLocation } from "../queries/get-location.handler.js";
import { handleSearchPlaces } from "../queries/search-places.handler.js";

/**
 * Location endpoints.
 *
 * Searching is separate from recording on purpose. A search returns candidates
 * from a map service and creates nothing; a place exists in Chronologity only
 * when someone chooses one, and then it carries an identity of ours rather
 * than the service's.
 *
 * @param deps - What the Location handlers need.
 * @returns A Fastify plugin registering the Location endpoints.
 */
export function locationRoutes(deps: LocationDependencies) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.get(
      "/places/search",
      {
        schema: {
          querystring: searchPlacesRequestSchema,
          response: { 200: placeSuggestionsSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        handleSearchPlaces(deps, {
          query: request.query.query,
          limit: request.query.limit,
        }),
    );

    app.post(
      "/locations",
      {
        schema: { body: createLocationRequestSchema, response: { 201: locationSchema } },
        preHandler: requireUser,
      },
      async (request, reply) => {
        const location = await handleRecordLocation(
          deps,
          recordLocationCommand(request.user.userId, request.body),
          request.requestContext,
        );

        return reply.status(201).send(location);
      },
    );

    app.get(
      "/locations/:locationId",
      {
        schema: {
          params: z.object({ locationId: identifierSchema }),
          response: { 200: locationSchema },
        },
        preHandler: requireUser,
      },
      async (request) => handleGetLocation(deps, { locationId: request.params.locationId }),
    );
  };
}
