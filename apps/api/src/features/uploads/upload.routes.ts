import {
  registerUploadRequestSchema,
  uploadAuthorizationSchema,
  uploadListSchema,
  uploadSchema,
} from "@chronologity/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { identifierSchema } from "@chronologity/contracts";
import { requireUser } from "../../plugins/auth.plugin.js";
import type { UploadService } from "./upload.service.js";

const uploadParams = z.object({ uploadId: identifierSchema });

/** How many uploads a listing returns. Bounded so a request cannot ask for everything. */
const LIST_LIMIT = 50;

/**
 * Upload endpoints.
 *
 * Nothing here accepts media bytes. The API authorises an upload and later
 * verifies what arrived; the bytes travel directly between the client and
 * object storage (`media.md:184`).
 *
 * @param uploads - The service these routes delegate to.
 * @returns A Fastify plugin registering the upload endpoints.
 */
export function uploadRoutes(uploads: UploadService) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.post(
      "/uploads",
      {
        schema: {
          body: registerUploadRequestSchema,
          response: { 201: uploadAuthorizationSchema },
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
        schema: { params: uploadParams, response: { 200: uploadSchema } },
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
      { schema: { response: { 200: uploadListSchema } }, preHandler: requireUser },
      async (request) => ({
        uploads: await uploads.list(request.user.userId, LIST_LIMIT),
      }),
    );

    app.get(
      "/uploads/:uploadId",
      {
        schema: { params: uploadParams, response: { 200: uploadSchema } },
        preHandler: requireUser,
      },
      async (request) => uploads.get(request.params.uploadId, request.user.userId),
    );

    app.delete(
      "/uploads/:uploadId",
      {
        schema: { params: uploadParams, response: { 204: z.null() } },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await uploads.delete(request.params.uploadId, request.user.userId);

        return reply.status(204).send(null);
      },
    );
  };
}
