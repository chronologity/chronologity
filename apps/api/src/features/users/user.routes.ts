import {
  confirmExportRequestSchema,
  createUserRequestSchema,
  exportStatusSchema,
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
import type { AccountDeletionService } from "../privacy/account-deletion.service.js";
import type { ExportService } from "../privacy/export.service.js";
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
 * @param accountDeletion - Asking for the account to be deleted and confirming
 *   it. Optional: a deployment with no erasure worker behind it should not
 *   offer a deletion it cannot finish.
 * @param dataExport - Asking for a copy of the account's history. Optional for
 *   the same reason: without a worker there is nobody to prepare one.
 * @returns A Fastify plugin registering the User endpoints.
 */
export function userRoutes(
  users: UserService,
  authentication: AuthenticationWiring,
  accountDeletion?: AccountDeletionService,
  dataExport?: ExportService,
) {
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

    if (accountDeletion !== undefined) {
      app.post(
        "/users/me/deletion",
        {
          schema: {
            summary: "Ask to delete your account",
            description: [
              "Sends a confirmation link to your verified email address. Nothing is deleted until you use it.",
              "",
              "**Deletion cannot be undone.** Your Moments, their photographs and videos, your comments, and your reactions are all removed. If you only want to step away for a while, deactivate instead.",
              "",
              "The link exists because a signed-in session proves somebody signed in once, which an unattended laptop also proves. Using it proves you can read the mailbox now. The mail arriving is itself the protection: somebody who has taken your account over cannot delete it without this reaching you.",
              "",
              "Asking twice sends a second link and cancels neither \u2014 otherwise anybody who could reach this could stop your deletion by asking again.",
            ].join("\n"),
            response: { 202: z.null(), ...errors(400, 401, 403) },
          },
          preHandler: requireUser,
        },
        async (request, reply) => {
          await accountDeletion.request(request.session.identityId, request.requestContext);

          return reply.status(202).send(null);
        },
      );

      app.post(
        "/users/me/deletion/confirmation",
        {
          schema: {
            summary: "Confirm that you want your account deleted",
            description: [
              "Takes the token from the confirmation link. Your account stops working immediately: every session ends, your addresses and password are removed, and your handle is released after a cooldown.",
              "",
              "What you recorded is removed afterwards rather than instantly, because a history of ten thousand Moments takes real work to erase. It is removed whether or not you are watching.",
              "",
              "A link issued for a different account, one already used, one that has expired, and one of another purpose all refuse identically.",
            ].join("\n"),
            body: z.object({ token: z.string().min(1).max(512) }),
            response: { 204: z.null(), ...errors(400, 401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request, reply) => {
          await accountDeletion.confirm(
            request.user.userId,
            request.session.identityId,
            request.body.token,
            request.requestContext,
          );

          return reply.status(204).send(null);
        },
      );
    }

    if (dataExport !== undefined) {
      app.post(
        "/users/me/export",
        {
          schema: {
            summary: "Ask for a copy of your history",
            description: [
              "Sends a confirmation link to your verified email address. Nothing is prepared until you use it.",
              "",
              "The link exists for the same reason deletion has one: an export is everything you have, and a signed-in session only shows that somebody signed in once. Using it shows you can read the mailbox now, and the mail arriving means a stranger holding your session cannot quietly take a copy of your history.",
            ].join("\n"),
            response: { 202: z.null(), ...errors(400, 401, 403) },
          },
          preHandler: requireUser,
        },
        async (request, reply) => {
          await dataExport.request(request.session.identityId, request.requestContext);

          return reply.status(202).send(null);
        },
      );

      app.post(
        "/users/me/export/confirmation",
        {
          schema: {
            summary: "Confirm that you want your history prepared",
            description:
              "Takes the token from the confirmation link and starts the work. A large history takes a while; check back with the endpoint below. Confirming while one is already being prepared changes nothing.",
            body: confirmExportRequestSchema,
            response: { 202: z.null(), ...errors(400, 401, 403) },
          },
          preHandler: requireUser,
        },
        async (request, reply) => {
          await dataExport.confirm(
            request.user.userId,
            request.session.identityId,
            request.body.token,
            request.requestContext,
          );

          return reply.status(202).send(null);
        },
      );

      app.get(
        "/users/me/export",
        {
          schema: {
            summary: "Where your export is",
            description: [
              "Reports how far along your export is and, once it is ready, where to fetch it.",
              "",
              "**Every link in the manifest is signed when you ask and lives for minutes.** A link signed when the export was built would still work days later, which is the same as having no expiry at all.",
              "",
              "Your photographs and videos are not copied to prepare an export \u2014 the manifest points at the originals. Media for a Moment you have since deleted is absent, because the manifest is built from what you have now rather than from what you had then.",
              "",
              "A prepared export is removed after a few days.",
            ].join("\n"),
            response: { 200: exportStatusSchema, ...errors(400, 401, 403) },
          },
          preHandler: requireUser,
        },
        async (request) => dataExport.status(request.user.userId),
      );
    }

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
