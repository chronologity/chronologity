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
import { errors } from "../../server/error-responses.js";
import type { AuthenticationWiring } from "../authentication/authentication.types.js";
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
 * @param authentication - Session revocation, which authentication owns and
 *   deactivation reuses. Composed here rather than inside the User service:
 *   sessions belong to authentication, and a service reaching across to end
 *   them would put that ownership in two places.
 * @returns A Fastify plugin registering the User endpoints.
 */
export function userRoutes(users: UserService, authentication: AuthenticationWiring) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    // Every route this module registers, grouped under one heading in the
    // published document. A hook rather than a line on each route: a route
    // added later is grouped without anybody remembering to say so.
    app.addHook("onRoute", (route) => {
      route.schema = { ...route.schema, tags: ["Users"] };
    });

    app.post(
      "/users",
      {
        schema: {
          summary: "Finish creating an account",
          description:
            "Authenticating proves who somebody is; it does not give them an account. Until this succeeds a caller holds an Identity, and every route needing a User answers 403 with `ONBOARDING_REQUIRED`.",
          body: createUserRequestSchema,
          response: { 201: currentUserSchema, ...errors(400, 401, 403) },
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
      {
        schema: {
          summary: "Read your own account",
          response: { 200: currentUserSchema, ...errors(401, 403) },
        },
        preHandler: requireUser,
      },
      async (request) => users.getAccount(request.user.userId),
    );

    app.patch(
      "/users/me",
      {
        schema: {
          summary: "Change your display name or biography",
          body: updateProfileRequestSchema,
          response: { 200: currentUserSchema, ...errors(400, 401, 403) },
        },
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
        schema: {
          summary: "Change your handle",
          description:
            "Handles are unique on their normalised form, so two people claiming one name at the same moment cannot both succeed. A released handle is reserved for a cooldown and may be reclaimed by its previous holder within it.",
          body: updateHandleRequestSchema,
          response: { 200: currentUserSchema, ...errors(400, 401, 403) },
        },
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
        schema: {
          summary: "Change your preferences",
          body: updatePreferencesRequestSchema,
          response: { 200: currentUserSchema, ...errors(400, 401, 403) },
        },
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
        schema: {
          summary: "Deactivate your account",
          description:
            "Ends every session and hides the account. Reversible by signing in again and reactivating; this is not deletion, and nothing recorded is removed.",
          response: {
            200: z.object({ sessionsRevoked: z.number().int().min(0) }),
            ...errors(401, 403),
          },
        },
        preHandler: requireUser,
      },
      async (request) => {
        await users.deactivate(request.user.userId);

        // Deactivating an account that leaves its sessions signed in would
        // deactivate nothing anyone can observe.
        const sessionsRevoked = await authentication.sessions.revokeAll({
          identityId: request.session.identityId,
          reason: "account_deactivated",
          context: request.requestContext,
        });

        return { sessionsRevoked };
      },
    );

    app.post(
      "/users/me/reactivate",
      {
        schema: {
          summary: "Reactivate your account",
          response: { 200: currentUserSchema, ...errors(401, 403) },
        },
        preHandler: requireUser,
      },
      async (request) => {
        await users.reactivate(request.user.userId);

        return users.getAccount(request.user.userId);
      },
    );

    app.get(
      "/users/:handle",
      {
        schema: {
          summary: "Read somebody's public profile",
          description:
            "The only route here needing no caller. It carries nothing a person has not chosen to present.",
          params: z.object({ handle: z.string().min(1).max(30) }),
          response: { 200: publicUserSchema, ...errors(404) },
        },
      },
      async (request) => users.getByHandle(request.params.handle),
    );
  };
}
