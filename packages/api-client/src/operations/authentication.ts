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
import { defineOperation } from "./operation.js";

/**
 * Proving who somebody is, and staying that way.
 *
 * **Three ways in, one Identity.** A link sent to an address, a password, and a
 * code sent to a phone number all end at the same account — which is why the
 * three sign-in operations return the same credentials rather than three shapes
 * a client would have to reconcile.
 *
 * **Every refusal here is the same refusal.** No operation discloses whether an
 * address, a handle or a number belongs to an account, so a client must not read
 * a failure as an answer to that question — and must not build a "is this email
 * registered?" affordance out of one.
 *
 * The credentials from any sign-in belong in `createSession`, which keeps them
 * current. Where the refresh token is *stored* is the caller's decision and
 * deliberately not this package's.
 */

/** Ask for a link to be sent. Answers the same whether or not the address is known. */
export const requestMagicLink = defineOperation({
  method: "POST",
  template: "/auth/magic-link",
  body: magicLinkRequestSchema,
  response: magicLinkResponseSchema,
});

/** Exchange a link's token for credentials. */
export const createSessionFromLink = defineOperation({
  method: "POST",
  template: "/auth/sessions",
  body: createSessionRequestSchema,
  response: sessionCredentialsSchema,
});

/** Sign in with a password. */
export const createSessionFromPassword = defineOperation({
  method: "POST",
  template: "/auth/sessions/password",
  body: passwordSignInRequestSchema,
  response: sessionCredentialsSchema,
});

/** Sign in with a code sent to a phone. */
export const createSessionFromPhone = defineOperation({
  method: "POST",
  template: "/auth/sessions/phone",
  body: phoneSignInRequestSchema,
  response: sessionCredentialsSchema,
});

/**
 * Exchange a refresh token for new credentials.
 *
 * Takes the Session's identifier as well as the token: the refresh token is held
 * only as a hash, so the server cannot look a Session up from it. `createSession`
 * calls this on the caller's behalf and is the ordinary way to reach it.
 */
export const refreshSession = defineOperation({
  method: "POST",
  template: "/auth/sessions/refresh",
  body: refreshSessionRequestSchema,
  response: sessionCredentialsSchema,
});

/** Every Session open for this account, including the one asking. */
export const listSessions = defineOperation({
  method: "GET",
  template: "/auth/sessions",
  response: sessionListSchema,
});

/** End one Session. Takes effect immediately rather than at expiry. */
export const revokeSession = defineOperation({
  method: "DELETE",
  template: "/auth/sessions/:sessionId",
  path: (args: { params: { sessionId: string } }) => `/auth/sessions/${args.params.sessionId}`,
  response: z.void(),
});

/** End every Session, including this one. */
export const revokeAllSessions = defineOperation({
  method: "DELETE",
  template: "/auth/sessions",
  response: z.object({ revoked: z.number().int().nonnegative() }),
});

/** Begin creating an account with an address and a password. */
export const register = defineOperation({
  method: "POST",
  template: "/auth/registrations",
  body: registrationRequestSchema,
  response: registrationResponseSchema,
});

/** Confirm an address from the token in its verification link. */
export const verifyEmail = defineOperation({
  method: "POST",
  template: "/auth/email-verifications",
  body: verifyEmailRequestSchema,
  response: z.void(),
});

/** Ask for a password reset link. */
export const requestPasswordReset = defineOperation({
  method: "POST",
  template: "/auth/password-resets",
  body: passwordResetRequestSchema,
  response: registrationResponseSchema,
});

/** Set a new password from a reset link's token. */
export const completePasswordReset = defineOperation({
  method: "POST",
  template: "/auth/password-resets/complete",
  body: passwordResetCompletionSchema,
  response: z.void(),
});

/** Change a password, knowing the current one. Ends every other Session. */
export const changePassword = defineOperation({
  method: "PUT",
  template: "/auth/password",
  body: passwordChangeRequestSchema,
  response: z.object({ otherSessionsRevoked: z.number().int().nonnegative() }),
});

/** Attach a phone number, which then needs verifying. */
export const addPhone = defineOperation({
  method: "POST",
  template: "/auth/phone",
  body: phoneRequestSchema,
  response: magicLinkResponseSchema,
});

/** Confirm a phone number with the code sent to it. */
export const verifyPhone = defineOperation({
  method: "POST",
  template: "/auth/phone/verify",
  body: confirmPhoneRequestSchema,
  response: z.null(),
});

/** The phone number held for this account, if any. */
export const getPhone = defineOperation({
  method: "GET",
  template: "/auth/phone",
  response: heldPhoneSchema,
});

/** Remove the phone number. */
export const removePhone = defineOperation({
  method: "DELETE",
  template: "/auth/phone",
  response: z.null(),
});

/** Send a sign-in code to a phone number. */
export const requestPhoneCode = defineOperation({
  method: "POST",
  template: "/auth/phone/codes",
  body: phoneRequestSchema,
  response: magicLinkResponseSchema,
});
