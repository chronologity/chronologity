import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireSession } from "../../../plugins/auth.plugin.js";
import { authenticateWithPassword } from "../commands/authenticate-with-password.command.js";
import { handleAuthenticateWithPassword } from "../commands/authenticate-with-password.handler.js";
import { changePassword } from "../commands/change-password.command.js";
import { handleChangePassword } from "../commands/change-password.handler.js";
import { createSession } from "../commands/create-session.command.js";
import { handleCreateSession } from "../commands/create-session.handler.js";
import { refreshSession } from "../commands/refresh-session.command.js";
import { handleRefreshSession } from "../commands/refresh-session.handler.js";
import { requestMagicLink } from "../commands/request-magic-link.command.js";
import { handleRequestMagicLink } from "../commands/request-magic-link.handler.js";
import { revokeAllUserSessions } from "../commands/revoke-all-user-sessions.command.js";
import { handleRevokeAllUserSessions } from "../commands/revoke-all-user-sessions.handler.js";
import { registerIdentity } from "../commands/register-identity.command.js";
import { handleRegisterIdentity } from "../commands/register-identity.handler.js";
import { requestPasswordReset } from "../commands/request-password-reset.command.js";
import { handleRequestPasswordReset } from "../commands/request-password-reset.handler.js";
import { resetPassword } from "../commands/reset-password.command.js";
import { handleResetPassword } from "../commands/reset-password.handler.js";
import { revokeSession } from "../commands/revoke-session.command.js";
import { handleRevokeSession } from "../commands/revoke-session.handler.js";
import { verifyIdentityEmail } from "../commands/verify-identity-email.command.js";
import { handleVerifyIdentityEmail } from "../commands/verify-identity-email.handler.js";
import type { AuthDependencies } from "../dependencies.js";
import { handleGetSessionsForUser } from "../queries/get-sessions-for-user.handler.js";
import { defaultAuthRateLimits } from "../rate-limit-policy.js";
import {
  createSessionBodySchema,
  passwordChangeBodySchema,
  passwordChangeResponseSchema,
  passwordResetBodySchema,
  passwordResetCompletionBodySchema,
  passwordSignInBodySchema,
  REGISTRATION_RESPONSE,
  registrationBodySchema,
  registrationResponseBodySchema,
  refreshSessionBodySchema,
  verifyEmailBodySchema,
  revokeAllResponseSchema,
  sessionCredentialsResponseSchema,
  sessionListResponseSchema,
  sessionParamsSchema,
} from "../schemas/create-session.schema.js";
import {
  MAGIC_LINK_RESPONSE,
  magicLinkBodySchema,
  magicLinkResponseBodySchema,
} from "../schemas/magic-link.schema.js";

/**
 * Authentication endpoints.
 *
 * Routes are transport only: they validate, construct a command or query, hand
 * it to its handler, and shape the response. No decision is made here.
 *
 * Every failure reaching a client is a bare 401. Distinguishing "no such
 * account" from "wrong link" from "expired link" is the information an attacker
 * is enumerating for, and none of it helps a legitimate caller.
 *
 * @param deps - Everything the handlers need, plus optional rate limits.
 * @returns A Fastify plugin registering the authentication endpoints.
 */
export function authRoutes(deps: AuthDependencies) {
  const limits = deps.rateLimits ?? defaultAuthRateLimits;
  const timeWindow = `${limits.windowMinutes} minutes`;

  return async function register(instance: FastifyInstance): Promise<void> {
    // Schemas are Zod, so routes are registered through the type provider that
    // makes body, params, and response types flow from them.
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.post(
      "/auth/magic-link",
      {
        schema: {
          body: magicLinkBodySchema,
          response: { 202: magicLinkResponseBodySchema },
        },
        config: {
          // Tighter than the global limit. See rate-limit-policy.ts for why.
          rateLimit: { max: limits.magicLinkRequestsPerWindow, timeWindow },
        },
      },
      async (request, reply) => {
        await handleRequestMagicLink(
          deps,
          requestMagicLink(request.body.email),
          request.requestContext,
        );

        return reply.status(202).send(MAGIC_LINK_RESPONSE);
      },
    );

    app.post(
      "/auth/sessions",
      {
        schema: {
          body: createSessionBodySchema,
          response: { 201: sessionCredentialsResponseSchema },
        },
        config: { rateLimit: { max: limits.sessionCreationsPerWindow, timeWindow } },
      },
      async (request, reply) => {
        const credentials = await handleCreateSession(
          deps,
          createSession(request.body.token, request.headers["user-agent"]?.slice(0, 64)),
          request.requestContext,
        );

        return reply.status(201).send(credentials);
      },
    );

    app.post(
      "/auth/sessions/refresh",
      {
        schema: {
          body: refreshSessionBodySchema,
          response: { 200: sessionCredentialsResponseSchema },
        },
      },
      async (request) =>
        handleRefreshSession(
          deps,
          refreshSession(request.body.sessionId, request.body.refreshToken),
          request.requestContext,
        ),
    );

    app.get(
      "/auth/sessions",
      { schema: { response: { 200: sessionListResponseSchema } }, preHandler: requireSession },
      async (request) => ({
        sessions: await handleGetSessionsForUser(deps, {
          identityId: request.session.identityId,
          currentSessionId: request.session.sessionId,
        }),
      }),
    );

    app.delete(
      "/auth/sessions/:sessionId",
      {
        schema: { params: sessionParamsSchema, response: { 204: z.void() } },
        preHandler: requireSession,
      },
      async (request, reply) => {
        await handleRevokeSession(
          deps,
          revokeSession(request.params.sessionId, request.session.identityId, "user_logout"),
          request.requestContext,
        );

        return reply.status(204).send();
      },
    );

    app.post(
      "/auth/registrations",
      {
        schema: {
          body: registrationBodySchema,
          response: { 202: registrationResponseBodySchema },
        },
        config: { rateLimit: { max: limits.registrationsPerWindow, timeWindow } },
      },
      async (request, reply) => {
        await handleRegisterIdentity(
          deps,
          registerIdentity(request.body.email, request.body.password),
          request.requestContext,
        );

        return reply.status(202).send(REGISTRATION_RESPONSE);
      },
    );

    app.post(
      "/auth/email-verifications",
      {
        schema: { body: verifyEmailBodySchema, response: { 204: z.void() } },
        config: { rateLimit: { max: limits.sessionCreationsPerWindow, timeWindow } },
      },
      async (request, reply) => {
        await handleVerifyIdentityEmail(
          deps,
          verifyIdentityEmail(request.body.token),
          request.requestContext,
        );

        return reply.status(204).send();
      },
    );

    app.post(
      "/auth/sessions/password",
      {
        schema: {
          body: passwordSignInBodySchema,
          response: { 201: sessionCredentialsResponseSchema },
        },
        config: { rateLimit: { max: limits.passwordAttemptsPerWindow, timeWindow } },
      },
      async (request, reply) => {
        const credentials = await handleAuthenticateWithPassword(
          deps,
          authenticateWithPassword(
            request.body.email,
            request.body.password,
            request.headers["user-agent"]?.slice(0, 64),
          ),
          request.requestContext,
        );

        return reply.status(201).send(credentials);
      },
    );

    app.post(
      "/auth/password-resets",
      {
        schema: {
          body: passwordResetBodySchema,
          response: { 202: registrationResponseBodySchema },
        },
        config: { rateLimit: { max: limits.magicLinkRequestsPerWindow, timeWindow } },
      },
      async (request, reply) => {
        await handleRequestPasswordReset(
          deps,
          requestPasswordReset(request.body.email),
          request.requestContext,
        );

        // Identical whether or not an account exists.
        return reply.status(202).send({
          message: "If an eligible account exists, reset instructions have been sent.",
        });
      },
    );

    app.post(
      "/auth/password-resets/complete",
      {
        schema: { body: passwordResetCompletionBodySchema, response: { 204: z.void() } },
        config: { rateLimit: { max: limits.passwordAttemptsPerWindow, timeWindow } },
      },
      async (request, reply) => {
        await handleResetPassword(
          deps,
          resetPassword(request.body.token, request.body.password),
          request.requestContext,
        );

        return reply.status(204).send();
      },
    );

    app.put(
      "/auth/password",
      {
        schema: { body: passwordChangeBodySchema, response: { 200: passwordChangeResponseSchema } },
        preHandler: requireSession,
      },
      async (request) => ({
        otherSessionsRevoked: await handleChangePassword(
          deps,
          changePassword({
            identityId: request.session.identityId,
            currentSessionId: request.session.sessionId,
            currentPassword: request.body.currentPassword,
            newPassword: request.body.newPassword,
          }),
          request.requestContext,
        ),
      }),
    );

    app.delete(
      "/auth/sessions",
      {
        schema: { response: { 200: revokeAllResponseSchema } },
        preHandler: requireSession,
      },
      async (request) => ({
        revoked: await handleRevokeAllUserSessions(
          deps,
          revokeAllUserSessions(request.session.identityId, "user_logout_all"),
          request.requestContext,
        ),
      }),
    );
  };
}
