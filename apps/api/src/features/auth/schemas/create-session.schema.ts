import {
  createSessionRequestSchema,
  passwordChangeRequestSchema,
  passwordResetCompletionSchema,
  passwordResetRequestSchema,
  passwordSignInRequestSchema,
  registrationRequestSchema,
  registrationResponseSchema,
  verifyEmailRequestSchema,
  refreshSessionRequestSchema,
  sessionCredentialsSchema,
  sessionListSchema,
} from "@chronologity/contracts";
import { z } from "zod";

/** Redeeming a sign-in link. */
export const createSessionBodySchema = createSessionRequestSchema;

/**
 * Refreshing.
 *
 * The session identifier is transport detail rather than part of the shared
 * contract: it names which Session is being refreshed, while the credential
 * itself is what proves the right to do so.
 */
export const refreshSessionBodySchema = refreshSessionRequestSchema.extend({
  sessionId: z.uuid(),
});

export const sessionCredentialsResponseSchema = sessionCredentialsSchema;
export const sessionListResponseSchema = sessionListSchema;

/** Identifying one Session in a path. */
export const sessionParamsSchema = z.object({ sessionId: z.uuid() });

export const revokeAllResponseSchema = z.object({
  revoked: z.number().int().nonnegative(),
});

/** Registering with an address and a password. */
export const registrationBodySchema = registrationRequestSchema;
export const registrationResponseBodySchema = registrationResponseSchema;

/** Signing in with a password. */
export const passwordSignInBodySchema = passwordSignInRequestSchema;

/** Proving control of a registered address. */
export const verifyEmailBodySchema = verifyEmailRequestSchema;

/** Password reset, in two steps. */
export const passwordResetBodySchema = passwordResetRequestSchema;
export const passwordResetCompletionBodySchema = passwordResetCompletionSchema;

/** Changing a password while signed in. */
export const passwordChangeBodySchema = passwordChangeRequestSchema;

export const passwordChangeResponseSchema = z.object({
  otherSessionsRevoked: z.number().int().nonnegative(),
});

/**
 * Identical whether or not the address is already registered.
 *
 * Telling the caller that an address is taken is a free account oracle; the
 * existing owner is notified by mail instead.
 */
export const REGISTRATION_RESPONSE = {
  message: "If that address can be registered, confirmation instructions have been sent.",
};
