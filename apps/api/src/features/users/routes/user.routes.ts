import {
  createUserRequestSchema,
  currentUserSchema,
  publicUserSchema,
  updateHandleRequestSchema,
  updatePreferencesRequestSchema,
  updateProfileRequestSchema,
} from "@chronologity/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireSession, requireUser } from "../../../plugins/auth.plugin.js";
import type { AuthDependencies } from "../../auth/index.js";
import { createUser } from "../commands/create-user.command.js";
import { handleCreateUser } from "../commands/create-user.handler.js";
import { deactivateUser } from "../commands/deactivate-user.command.js";
import { handleDeactivateUser } from "../commands/deactivate-user.handler.js";
import { reactivateUser } from "../commands/reactivate-user.command.js";
import { handleReactivateUser } from "../commands/reactivate-user.handler.js";
import { updateHandle } from "../commands/update-handle.command.js";
import { handleUpdateHandle } from "../commands/update-handle.handler.js";
import { updatePreferences } from "../commands/update-preferences.command.js";
import { handleUpdatePreferences } from "../commands/update-preferences.handler.js";
import { updateProfile } from "../commands/update-profile.command.js";
import { handleUpdateProfile } from "../commands/update-profile.handler.js";
import type { UserDependencies } from "../dependencies.js";
import { handleGetCurrentUser } from "../queries/get-current-user.handler.js";
import { handleGetUserByHandle } from "../queries/get-user-by-handle.handler.js";

/**
 * User endpoints.
 *
 * Account creation needs only an authenticated Identity, since its whole
 * purpose is to produce the User that everything else requires. Every other
 * route here needs a User, and says so through `requireUser` rather than by
 * discovering the absence halfway through a handler.
 *
 * @param deps - What the User handlers need.
 * @param auth - Session revocation, which the auth feature owns and
 *   deactivation reuses.
 * @returns A Fastify plugin registering the User endpoints.
 */
export function userRoutes(deps: UserDependencies, auth: AuthDependencies) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.post(
      "/users",
      {
        schema: {
          body: createUserRequestSchema,
          response: { 201: currentUserSchema },
        },
        preHandler: requireSession,
      },
      async (request, reply) => {
        const userId = await handleCreateUser(
          deps,
          createUser(request.session.identityId, request.body),
          request.requestContext,
        );

        return reply.status(201).send(await handleGetCurrentUser(deps, { userId }));
      },
    );

    app.get(
      "/users/me",
      { schema: { response: { 200: currentUserSchema } }, preHandler: requireUser },
      async (request) => handleGetCurrentUser(deps, { userId: request.user.userId }),
    );

    app.patch(
      "/users/me",
      {
        schema: { body: updateProfileRequestSchema, response: { 200: currentUserSchema } },
        preHandler: requireUser,
      },
      async (request) => {
        await handleUpdateProfile(
          deps,
          updateProfile(request.user.userId, request.body),
          request.requestContext,
        );

        return handleGetCurrentUser(deps, { userId: request.user.userId });
      },
    );

    app.put(
      "/users/me/handle",
      {
        schema: { body: updateHandleRequestSchema, response: { 200: currentUserSchema } },
        preHandler: requireUser,
      },
      async (request) => {
        await handleUpdateHandle(
          deps,
          updateHandle(request.user.userId, request.body.handle),
          request.requestContext,
        );

        return handleGetCurrentUser(deps, { userId: request.user.userId });
      },
    );

    app.put(
      "/users/me/preferences",
      {
        schema: { body: updatePreferencesRequestSchema, response: { 200: currentUserSchema } },
        preHandler: requireUser,
      },
      async (request) => {
        await handleUpdatePreferences(
          deps,
          updatePreferences(request.user.userId, request.body),
          request.requestContext,
        );

        return handleGetCurrentUser(deps, { userId: request.user.userId });
      },
    );

    app.post(
      "/users/me/deactivate",
      {
        schema: { response: { 200: z.object({ sessionsRevoked: z.number().int().min(0) }) } },
        preHandler: requireUser,
      },
      async (request) => ({
        sessionsRevoked: await handleDeactivateUser(
          deps,
          auth,
          deactivateUser(request.user.userId, request.session.identityId),
          request.requestContext,
        ),
      }),
    );

    app.post(
      "/users/me/reactivate",
      { schema: { response: { 200: currentUserSchema } }, preHandler: requireUser },
      async (request) => {
        await handleReactivateUser(
          deps,
          reactivateUser(request.user.userId),
          request.requestContext,
        );

        return handleGetCurrentUser(deps, { userId: request.user.userId });
      },
    );

    app.get(
      "/users/:handle",
      {
        schema: {
          params: z.object({ handle: z.string().min(1).max(30) }),
          response: { 200: publicUserSchema },
        },
      },
      async (request) => handleGetUserByHandle(deps, { handle: request.params.handle }),
    );
  };
}
