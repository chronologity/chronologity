import {
  embeddedPlaceSuggestionsSchema,
  registerUploadRequestSchema,
  uploadAuthorizationSchema,
  listUploadsRequestSchema,
  uploadListSchema,
  uploadSchema,
} from "@chronologity/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { identifierSchema } from "@chronologity/contracts";
import { requireUser } from "../../plugins/auth.plugin.js";
import { errors } from "../../server/error-responses.js";
import type { LocationService } from "../locations/location.service.js";
import type { UploadService } from "./upload.service.js";

const uploadParams = z.object({ uploadId: identifierSchema });

/** How many uploads a listing returns. Bounded so a request cannot ask for everything. */

/**
 * What to credit when no map data was used.
 *
 * A file carrying no location asks the map service nothing, so there is nothing
 * of theirs to attribute. The field stays present rather than becoming optional,
 * because a client that has to check whether attribution exists is a client that
 * will eventually forget to show it.
 */
const ATTRIBUTION_WHEN_NOTHING_ASKED = "";

/**
 * Upload endpoints.
 *
 * Nothing here accepts media bytes. The API authorises an upload and later
 * verifies what arrived; the bytes travel directly between the client and
 * object storage (`media.md:184`).
 *
 * @param uploads - The service these routes delegate to.
 * @param locations - Optional. Names the places a file's own coordinates point
 *   at. Composed here rather than inside either service: reading a file belongs
 *   to uploads and naming a place belongs to locations, and a service reaching
 *   across would put one of those in two places. Without it the endpoint that
 *   needs both is not mounted, rather than mounted and failing.
 * @returns A Fastify plugin registering the upload endpoints.
 */
export function uploadRoutes(uploads: UploadService, locations?: LocationService) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    // Every route this module registers, grouped under one heading in the
    // published document. A hook rather than a line on each route: a route
    // added later is grouped without anybody remembering to say so.
    app.addHook("onRoute", (route) => {
      route.schema = { ...route.schema, tags: ["Uploads"] };
    });

    app.post(
      "/uploads",
      {
        schema: {
          summary: "Register an upload and get somewhere to put it",
          description:
            "Returns a short-lived URL to PUT the bytes to directly. Large media never travels through the API. Nothing is trusted from this request: the declared content type and size are checked against the file itself once it arrives.",
          body: registerUploadRequestSchema,
          response: { 201: uploadAuthorizationSchema, ...errors(400, 401, 403) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        const authorization = await uploads.register(request.user.userId, request.body);

        return reply.status(201).send(authorization);
      },
    );

    app.post(
      "/uploads/:uploadId/finalize",
      {
        schema: {
          summary: "Say the bytes have arrived",
          description:
            "Verifies the object is really there, then queues it for checking. An upload reaches `ready` only after a decoder has opened it and found it to be what it claimed — until then it cannot represent a Moment.",
          params: uploadParams,
          response: { 200: uploadSchema, ...errors(400, 401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request) => {
        await uploads.finalize(
          request.params.uploadId,
          request.user.userId,
          request.requestContext,
        );

        return uploads.get(request.params.uploadId, request.user.userId);
      },
    );

    app.get(
      "/uploads",
      {
        schema: {
          summary: "List your own uploads",
          description:
            "Paged by cursor. The cursor is opaque: it encodes where the ordering continues from, and taking it apart will break when the ordering changes.",
          querystring: listUploadsRequestSchema,
          response: { 200: uploadListSchema, ...errors(400, 401, 403) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        uploads.list(request.user.userId, request.query.limit, request.query.cursor),
    );

    app.get(
      "/uploads/:uploadId",
      {
        schema: {
          summary: "Read one upload",
          params: uploadParams,
          response: { 200: uploadSchema, ...errors(401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request) => uploads.get(request.params.uploadId, request.user.userId),
    );

    // Mounted only when both features are: it is the one operation here that
    // spans them, and an endpoint that cannot work should be absent rather than
    // present and failing.
    if (locations !== undefined) {
      app.get(
        "/uploads/:uploadId/places",
        {
          schema: {
            summary: "Places suggested by a photograph",
            description:
              "Read from the file each time and kept nowhere. The position itself is never returned — it is used to ask what is nearby, and the named places are what the owner chooses from. A photograph knowing where it was taken does not make that a fact about somebody's history.",
            params: uploadParams,
            response: { 200: embeddedPlaceSuggestionsSchema, ...errors(401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request) => {
          // Read from the file each time it is asked for, and kept nowhere. A
          // photograph knowing where it was taken does not make that a fact
          // about somebody's history; it makes it something to offer them
          // (`locations.md:373`).
          const coordinates = await uploads.embeddedCoordinates(
            request.params.uploadId,
            request.user.userId,
          );

          if (coordinates === undefined) {
            return { suggestions: [], attribution: ATTRIBUTION_WHEN_NOTHING_ASKED, found: false };
          }

          // The position itself is never returned. It is used to ask what is
          // there, and the named places are what the owner chooses from.
          const { suggestions, attribution } = await locations.suggestFor(coordinates);

          return { suggestions, attribution, found: true };
        },
      );
    }

    app.delete(
      "/uploads/:uploadId",
      {
        schema: {
          summary: "Delete an upload",
          description: "Removes the stored object as well as the record.",
          params: uploadParams,
          response: { 204: z.null(), ...errors(401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await uploads.delete(request.params.uploadId, request.user.userId);

        return reply.status(204).send(null);
      },
    );
  };
}
