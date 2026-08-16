import {
  identifierSchema,
  registerUploadRequestSchema,
  uploadAuthorizationSchema,
  uploadListSchema,
  uploadSchema,
} from "@chronologity/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../../../plugins/auth.plugin.js";
import { deleteUpload } from "../commands/delete-upload.command.js";
import { handleDeleteUpload } from "../commands/delete-upload.handler.js";
import { finalizeUpload } from "../commands/finalize-upload.command.js";
import { handleFinalizeUpload } from "../commands/finalize-upload.handler.js";
import { registerUpload } from "../commands/register-upload.command.js";
import { handleRegisterUpload } from "../commands/register-upload.handler.js";
import type { UploadDependencies } from "../dependencies.js";
import { handleGetUploadById } from "../queries/get-upload-by-id.handler.js";
import { handleGetUploadsForUser } from "../queries/get-uploads-for-user.handler.js";

const uploadParams = z.object({ uploadId: identifierSchema });

/**
 * Upload endpoints.
 *
 * Every route requires a completed account: an upload belongs to a User, and
 * an authenticated Identity without one has nowhere to put it.
 *
 * Nothing here accepts media bytes. The API authorises an upload and later
 * verifies what arrived; the bytes travel directly between the client and
 * object storage (`media.md:184`).
 *
 * @param deps - What the Upload handlers need.
 * @returns A Fastify plugin registering the upload endpoints.
 */
export function uploadRoutes(deps: UploadDependencies) {
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
        const authorization = await handleRegisterUpload(
          deps,
          registerUpload(request.user.userId, request.body),
          request.requestContext,
        );

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
        await handleFinalizeUpload(
          deps,
          finalizeUpload(request.params.uploadId, request.user.userId),
          request.requestContext,
        );

        return handleGetUploadById(deps, {
          uploadId: request.params.uploadId,
          actorUserId: request.user.userId,
        });
      },
    );

    app.get(
      "/uploads",
      { schema: { response: { 200: uploadListSchema } }, preHandler: requireUser },
      async (request) => handleGetUploadsForUser(deps, { ownerUserId: request.user.userId }),
    );

    app.get(
      "/uploads/:uploadId",
      {
        schema: { params: uploadParams, response: { 200: uploadSchema } },
        preHandler: requireUser,
      },
      async (request) =>
        handleGetUploadById(deps, {
          uploadId: request.params.uploadId,
          actorUserId: request.user.userId,
        }),
    );

    app.delete(
      "/uploads/:uploadId",
      {
        schema: { params: uploadParams, response: { 204: z.null() } },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await handleDeleteUpload(
          deps,
          deleteUpload(request.params.uploadId, request.user.userId),
          request.requestContext,
        );

        return reply.status(204).send(null);
      },
    );
  };
}
