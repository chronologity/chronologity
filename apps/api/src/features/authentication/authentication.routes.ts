import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  confirmPhoneRequestSchema,
  createSessionRequestSchema,
  heldPhoneSchema,
  magicLinkRequestSchema,
  magicLinkResponseSchema,
  passwordChangeRequestSchema,
  passwordResetCompletionSchema,
  passwordResetRequestSchema,
  passwordSignInRequestSchema,
  phoneRequestSchema,
  phoneSignInRequestSchema,
  refreshSessionRequestSchema,
  registrationRequestSchema,
  registrationResponseSchema,
  sessionCredentialsSchema,
  sessionListSchema,
  verifyEmailRequestSchema,
} from "@chronologity/contracts";
import { z } from "zod";
import { requireSession } from "../../plugins/auth.plugin.js";
import { errors } from "../../server/error-responses.js";
import { defaultAuthRateLimits } from "./authentication.rate-limits.js";
import type { AuthenticationWiring } from "./authentication.types.js";

/**
 * Authentication endpoints.
 *
 * Routes are transport only: they validate, call a service, and shape the
 * response. No decision is made here.
 *
 * Every failure reaching a client is a bare 401. Distinguishing "no such
 * account" from "wrong link" from "expired link" is the information an attacker
 * is enumerating for, and none of it helps a legitimate caller.
 */

/**
 * Refreshing.
 *
 * The session identifier is transport detail rather than part of the shared
 * contract: it names which Session is being refreshed, while the credential
 * itself is what proves the right to do so.
 */
const refreshSessionBodySchema = refreshSessionRequestSchema.extend({ sessionId: z.uuid() });

/** Identifying one Session in a path. */
const sessionParamsSchema = z.object({ sessionId: z.uuid() });

const revokeAllResponseSchema = z.object({ revoked: z.number().int().nonnegative() });

const passwordChangeResponseSchema = z.object({
  otherSessionsRevoked: z.number().int().nonnegative(),
});

/**
 * Deliberately identical whether or not the address is known
 * (`authentication.md:951`).
 */
const MAGIC_LINK_RESPONSE = {
  message: "If an eligible account exists, sign-in instructions have been sent.",
};

/**
 * Identical whether or not the address is already registered.
 *
 * Telling the caller that an address is taken is a free account oracle; the
 * existing owner is notified by mail instead.
 */
/**
 * Identical whether the number is unknown, unproven, dormant, or good.
 *
 * A response that differed would tell whoever asked which numbers hold
 * accounts, which is exactly what ADR-081 forbids.
 */
const PHONE_CODE_RESPONSE = {
  message: "If that number can be used to sign in, a code has been sent to it.",
};

const REGISTRATION_RESPONSE = {
  message: "If that address can be registered, confirmation instructions have been sent.",
};

/**
 * Register the authentication endpoints.
 *
 * @param wiring - The two services, plus optional endpoint limits.
 * @returns A Fastify plugin registering the authentication endpoints.
 */
export function authenticationRoutes(wiring: AuthenticationWiring) {
  const { identities, sessions, phones } = wiring;
  const limits = wiring.rateLimits ?? defaultAuthRateLimits;
  const timeWindow = `${limits.windowMinutes} minutes`;

  return async function register(instance: FastifyInstance): Promise<void> {
    // Schemas are Zod, so routes are registered through the type provider that
    // makes body, params, and response types flow from them.
    const app = instance.withTypeProvider<ZodTypeProvider>();

    // Every route this module registers, grouped under one heading in the
    // published document. A hook rather than a line on each route: a route
    // added later is grouped without anybody remembering to say so.
    app.addHook("onRoute", (route) => {
      route.schema = { ...route.schema, tags: ["Authentication"] };
    });

    app.post(
      "/auth/magic-link",
      {
        schema: {
          body: magicLinkRequestSchema,
          summary: "Send a sign-in link",
          description: "Answers identically whether or not an account exists. No authentication surface here discloses membership, because knowing that an address, handle, or number has an account is itself a fact about a person.",
          response: { 202: magicLinkResponseSchema, ...errors(400) },
        },
        config: {
          // Tighter than the global limit. See authentication.rate-limits.ts.
          rateLimit: { max: limits.magicLinkRequestsPerWindow, timeWindow },
        },
      },
      async (request, reply) => {
        await identities.requestLink(request.body.email, request.requestContext);

        return reply.status(202).send(MAGIC_LINK_RESPONSE);
      },
    );

    // Mounted only when there is something to send a text with. An endpoint
    // that cannot work should be absent rather than present and failing.
    if (phones !== undefined) {
      app.post(
        "/auth/phone",
        {
          schema: {
            summary: "Claim a phone number",
            description:
              "Sends a code to prove the number is yours. Claiming replaces whatever number the account held before, and the replacement starts unverified.",
            body: phoneRequestSchema,
            response: { 202: magicLinkResponseSchema, ...errors(400, 401) },
          },
          config: { rateLimit: { max: limits.phoneCodeRequestsPerWindow, timeWindow } },
          preHandler: requireSession,
        },
        async (request, reply) => {
          await phones.claim(
            request.session.identityId,
            request.body.phone,
            request.requestContext,
          );

          return reply.status(202).send({ message: "A code has been sent to that number." });
        },
      );

      app.post(
        "/auth/phone/verify",
        {
          schema: {
            summary: "Confirm a claimed number",
            description:
              "A wrong code, an expired one, one already used, and one guessed at too often are all the same refusal. Enough wrong guesses spend the code, whether or not the right one arrives afterwards.",
            body: confirmPhoneRequestSchema,
            response: { 204: z.null(), ...errors(400, 401) },
          },
          config: { rateLimit: { max: limits.phoneCodeAttemptsPerWindow, timeWindow } },
          preHandler: requireSession,
        },
        async (request, reply) => {
          await phones.confirm(
            request.session.identityId,
            request.body.code,
            request.requestContext,
          );

          return reply.status(204).send(null);
        },
      );

      app.get(
        "/auth/phone",
        {
          schema: {
            summary: "Read the number on your account",
            description:
              "`dormant` says the number has gone unused long enough to stop working for sign-in until confirmed again. You are told because you are the only person who can act on it.",
            response: { 200: heldPhoneSchema, ...errors(401) },
          },
          preHandler: requireSession,
        },
        async (request) => {
          const held = await phones.held(request.session.identityId);

          return held === undefined
            ? { phone: null, verified: false, dormant: false }
            : { phone: held.phone, verified: held.verified, dormant: held.dormant };
        },
      );

      app.delete(
        "/auth/phone",
        {
          schema: {
            summary: "Remove your phone number",
            description: "Removing one you do not have is the state you asked for, not an error.",
            response: { 204: z.null(), ...errors(401) },
          },
          preHandler: requireSession,
        },
        async (request, reply) => {
          await phones.remove(request.session.identityId, request.requestContext);

          return reply.status(204).send(null);
        },
      );

      // Answers identically whether the number is unknown, unproven, dormant,
      // or perfectly good. ADR-081 requires that no authentication surface
      // disclose whether an account exists, and this is one.
      app.post(
        "/auth/phone/codes",
        {
          schema: {
            summary: "Send a sign-in code by text",
            description:
              "Answers identically whether or not an account exists. No authentication surface here discloses membership, because knowing that an address, handle, or number has an account is itself a fact about a person. A number that has gone unused for a long period receives no code at all; the account's email address is told instead, because a number left unused is the one a carrier may have given to somebody else.",
            body: phoneRequestSchema,
            response: { 202: magicLinkResponseSchema, ...errors(400) },
          },
          config: { rateLimit: { max: limits.phoneCodeRequestsPerWindow, timeWindow } },
        },
        async (request, reply) => {
          await phones.requestSignInCode(request.body.phone, request.requestContext);

          return reply.status(202).send(PHONE_CODE_RESPONSE);
        },
      );

      app.post(
        "/auth/sessions/phone",
        {
          schema: {
            summary: "Sign in with a number and code",
            description:
              "Succeeding emails the account, so its holder learns of it even if the number was taken from them.",
            body: phoneSignInRequestSchema,
            response: { 201: sessionCredentialsSchema, ...errors(400, 401) },
          },
          config: { rateLimit: { max: limits.phoneCodeAttemptsPerWindow, timeWindow } },
        },
        async (request, reply) => {
          const credentials = await phones.signIn(
            request.body.phone,
            request.body.code,
            request.headers["user-agent"]?.slice(0, 64),
            request.requestContext,
          );

          return reply.status(201).send(credentials);
        },
      );
    }

    app.post(
      "/auth/sessions",
      {
        schema: {
          summary: "Redeem a sign-in link",
          description:
            "An expired link, an already-used one, one issued for another purpose, and one that never existed are all the same refusal. Redeeming proves control of the address, so a first-time address arrives already verified.",
          body: createSessionRequestSchema,
          response: { 201: sessionCredentialsSchema, ...errors(400, 401) },
        },
        config: { rateLimit: { max: limits.sessionCreationsPerWindow, timeWindow } },
      },
      async (request, reply) => {
        const credentials = await identities.signInWithLink(
          request.body.token,
          request.headers["user-agent"]?.slice(0, 64),
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
          summary: "Exchange a refresh token",
          description:
            "Refresh tokens rotate: the one sent is spent, and a new one comes back. Reusing a spent token ends the session, because reuse means it was copied.",
          response: { 200: sessionCredentialsSchema, ...errors(400, 401) },
        },
      },
      async (request) =>
        sessions.refresh(
          request.body.sessionId,
          request.body.refreshToken,
          request.requestContext,
        ),
    );

    app.get(
      "/auth/sessions",
      {
        schema: {
          summary: "List your open sessions",
          description: "The session making the request is marked as such.",
          response: { 200: sessionListSchema, ...errors(401) },
        },
        preHandler: requireSession,
      },
      async (request) => ({
        sessions: await sessions.list(request.session.identityId, request.session.sessionId),
      }),
    );

    app.delete(
      "/auth/sessions/:sessionId",
      {
        schema: {
          summary: "End one session",
          description: "Takes effect on that session's next request rather than at its next expiry.",
          params: sessionParamsSchema,
          response: { 204: z.void(), ...errors(401, 404) },
        },
        preHandler: requireSession,
      },
      async (request, reply) => {
        await sessions.revoke(
          request.params.sessionId,
          request.session.identityId,
          "user_logout",
          request.requestContext,
        );

        return reply.status(204).send();
      },
    );

    app.post(
      "/auth/registrations",
      {
        schema: {
          summary: "Register with a password",
          description:
            "Answers identically whether or not an account exists. Registering does not prove the address — redeeming the link sent to it does — and password sign-in is refused until it is proven.",
          body: registrationRequestSchema,
          response: { 202: registrationResponseSchema, ...errors(400) },
        },
        config: { rateLimit: { max: limits.registrationsPerWindow, timeWindow } },
      },
      async (request, reply) => {
        await identities.register(
          request.body.email,
          request.body.password,
          request.requestContext,
        );

        return reply.status(202).send(REGISTRATION_RESPONSE);
      },
    );

    app.post(
      "/auth/email-verifications",
      {
        schema: {
          summary: "Prove an email address",
          description:
            "Proving an address grants no session. Proof of who somebody is and being signed in are deliberately separate.",
          body: verifyEmailRequestSchema,
          response: { 204: z.void(), ...errors(400) },
        },
        config: { rateLimit: { max: limits.sessionCreationsPerWindow, timeWindow } },
      },
      async (request, reply) => {
        await identities.verifyEmail(request.body.token, request.requestContext);

        return reply.status(204).send();
      },
    );

    app.post(
      "/auth/sessions/password",
      {
        schema: {
          summary: "Sign in with a password",
          description:
            "Answers identically whether or not an account exists. No such account, a wrong password, and an unproven address are one refusal — and the work is done either way, so the time taken says nothing either.",
          body: passwordSignInRequestSchema,
          response: { 201: sessionCredentialsSchema, ...errors(400, 401) },
        },
        config: { rateLimit: { max: limits.passwordAttemptsPerWindow, timeWindow } },
      },
      async (request, reply) => {
        const credentials = await identities.signInWithPassword(
          request.body.email,
          request.body.password,
          request.headers["user-agent"]?.slice(0, 64),
          request.requestContext,
        );

        return reply.status(201).send(credentials);
      },
    );

    app.post(
      "/auth/password-resets",
      {
        schema: {
          summary: "Ask for a password reset",
          description: "Answers identically whether or not an account exists.",
          body: passwordResetRequestSchema,
          response: { 202: registrationResponseSchema, ...errors(400) },
        },
        config: { rateLimit: { max: limits.magicLinkRequestsPerWindow, timeWindow } },
      },
      async (request, reply) => {
        await identities.requestPasswordReset(request.body.email, request.requestContext);

        // Identical whether or not an account exists.
        return reply.status(202).send({
          message: "If an eligible account exists, reset instructions have been sent.",
        });
      },
    );

    app.post(
      "/auth/password-resets/complete",
      {
        schema: {
          summary: "Set a new password with a reset link",
          description:
            "Every other session ends, because a reset usually means the old password was known to somebody else.",
          body: passwordResetCompletionSchema,
          response: { 204: z.void(), ...errors(400) },
        },
        config: { rateLimit: { max: limits.passwordAttemptsPerWindow, timeWindow } },
      },
      async (request, reply) => {
        await identities.resetPassword(
          request.body.token,
          request.body.password,
          request.requestContext,
        );

        return reply.status(204).send();
      },
    );

    app.put(
      "/auth/password",
      {
        schema: {
          body: passwordChangeRequestSchema,
          summary: "Change your password",
          description:
            "Requires the current one. Every other session ends; the one making the change continues.",
          response: { 200: passwordChangeResponseSchema, ...errors(400, 401) },
        },
        preHandler: requireSession,
      },
      async (request) => ({
        otherSessionsRevoked: await identities.changePassword(
          {
            identityId: request.session.identityId,
            currentSessionId: request.session.sessionId,
            currentPassword: request.body.currentPassword,
            newPassword: request.body.newPassword,
          },
          request.requestContext,
        ),
      }),
    );

    app.delete(
      "/auth/sessions",
      {
        schema: {
          summary: "End every session",
          description: "Including the one making the request.",
          response: { 200: revokeAllResponseSchema, ...errors(401) },
        },
        preHandler: requireSession,
      },
      async (request) => ({
        revoked: await sessions.revokeAll({
          identityId: request.session.identityId,
          reason: "user_logout_all",
          context: request.requestContext,
        }),
      }),
    );
  };
}
