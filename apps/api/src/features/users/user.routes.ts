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
import { requireSession, requireUser } from "../../plugins/auth.plugin.js";
import type { AuthDependencies } from "../auth/index.js";
import { revokeAllUserSessions } from "../auth/commands/revoke-all-user-sessions.command.js";
import { handleRevokeAllUserSessions } from "../auth/commands/revoke-all-user-sessions.handler.js";
import type { UserService } from "./user.service.js";

/**
 * User endpoints.
 *
 * Account creation needs only an authenticated Identity, since its whole
 * purpose is to produce the User that everything else requires. Every other
 * route here needs a User, and says so through `requireUser` rather than by
 * discovering the absence halfway through a handler.
 *
 * @param users - The service these routes delegate to.
 * @param auth - Session revocation, which the auth feature owns and
 *   deactivation reuses. Composed here rather than inside the User service:
 *   sessions belong to authentication, and a service reaching across to end
 *   them would put that ownership in two places.
 * @returns A Fastify plugin registering the User endpoints.
 */
export function userRoutes(users: UserService, auth: AuthDependencies) {
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
        const userId = await users.create(request.session.identityId, request.body);

        return reply.status(201).send(await users.getAccount(userId));
      },
    );

    app.get(
      "/users/me",
      { schema: { response: { 200: currentUserSchema } }, preHandler: requireUser },
      async (request) => users.getAccount(request.user.userId),
    );

    app.patch(
      "/users/me",
      {
        schema: { body: updateProfileRequestSchema, response: { 200: currentUserSchema } },
        preHandler: requireUser,
      },
      async (request) => {
        await users.updateProfile(request.user.userId, request.body);

        return users.getAccount(request.user.userId);
      },
    );

    app.put(
      "/users/me/handle",
      {
        schema: { body: updateHandleRequestSchema, response: { 200: currentUserSchema } },
        preHandler: requireUser,
      },
      async (request) => {
        await users.updateHandle(request.user.userId, request.body.handle);

        return users.getAccount(request.user.userId);
      },
    );

    app.put(
      "/users/me/preferences",
      {
        schema: { body: updatePreferencesRequestSchema, response: { 200: currentUserSchema } },
        preHandler: requireUser,
      },
      async (request) => {
        await users.updatePreferences(request.user.userId, request.body);

        return users.getAccount(request.user.userId);
      },
    );

    app.post(
      "/users/me/deactivate",
      {
        schema: { response: { 200: z.object({ sessionsRevoked: z.number().int().min(0) }) } },
        preHandler: requireUser,
      },
      async (request) => {
        await users.deactivate(request.user.userId);

        // Deactivating an account that leaves its sessions signed in would
        // deactivate nothing anyone can observe.
        const sessionsRevoked = await handleRevokeAllUserSessions(
          auth,
          revokeAllUserSessions(request.session.identityId, "account_deactivated"),
          request.requestContext,
        );

        return { sessionsRevoked };
      },
    );

    app.post(
      "/users/me/reactivate",
      { schema: { response: { 200: currentUserSchema } }, preHandler: requireUser },
      async (request) => {
        await users.reactivate(request.user.userId);

        return users.getAccount(request.user.userId);
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
      async (request) => users.getByHandle(request.params.handle),
    );
  };
}
