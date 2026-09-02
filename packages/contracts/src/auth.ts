import { z } from "zod";
import { identifierSchema } from "./identifiers.js";
import { timestampSchema } from "./time.js";

/**
 * Authentication boundary contracts.
 *
 * Chronologity authenticates with magic links and never with passwords, so no
 * schema here carries one. Nothing in this file describes a credential's
 * contents beyond what a client must send back.
 */

/**
 * Requesting a login link.
 *
 * The response is deliberately identical whether or not the address is known,
 * so this request cannot be used to discover who has an account.
 */
export const magicLinkRequestSchema = z.object({
  email: z.email().max(320),
});

export type MagicLinkRequest = z.infer<typeof magicLinkRequestSchema>;

/**
 * A phone number as somebody types it.
 *
 * Must carry its country, as a leading `+`. There is no default: guessing one
 * would resolve an ambiguous number to a real telephone in the wrong country
 * rather than refusing it.
 */
export const phoneNumberSchema = z
  .string()
  .trim()
  .min(4)
  .max(20)
  .regex(/^\+[0-9 ()\-.]+$/, "A phone number must start with + and its country code");

export type PhoneNumber = z.infer<typeof phoneNumberSchema>;

/** The code sent by text. Six digits, and nothing else. */
export const phoneCodeSchema = z.string().trim().regex(/^[0-9]{6}$/, "A code is six digits");

/** Claiming a number, or asking for a code to sign in with. */
export const phoneRequestSchema = z.object({ phone: phoneNumberSchema });

export type PhoneRequest = z.infer<typeof phoneRequestSchema>;

/** Confirming a claimed number. */
export const confirmPhoneRequestSchema = z.object({ code: phoneCodeSchema });

export type ConfirmPhoneRequest = z.infer<typeof confirmPhoneRequestSchema>;

/** Signing in with a number and the code sent to it. */
export const phoneSignInRequestSchema = z.object({
  phone: phoneNumberSchema,
  code: phoneCodeSchema,
});

export type PhoneSignInRequest = z.infer<typeof phoneSignInRequestSchema>;

/**
 * The number on an account, as its holder sees it.
 *
 * `dormant` is told to its holder deliberately. They are the only person who
 * can act on it, and it discloses nothing about anybody else.
 */
export const heldPhoneSchema = z.object({
  phone: phoneNumberSchema.nullable(),
  verified: z.boolean(),
  dormant: z.boolean(),
});

export type HeldPhone = z.infer<typeof heldPhoneSchema>;

export const magicLinkResponseSchema = z.object({
  message: z.string(),
});

export type MagicLinkResponse = z.infer<typeof magicLinkResponseSchema>;

/**
 * Registering with an address and a password.
 *
 * The response is identical whether or not the address is already registered,
 * so this cannot be used to discover who has an account.
 */
export const registrationRequestSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(1024),
});

export type RegistrationRequest = z.infer<typeof registrationRequestSchema>;

export const registrationResponseSchema = z.object({
  message: z.string(),
});

export type RegistrationResponse = z.infer<typeof registrationResponseSchema>;

/** Signing in with a password. */
export const passwordSignInRequestSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(1024),
});

export type PasswordSignInRequest = z.infer<typeof passwordSignInRequestSchema>;

/** Proving control of an address after registering. */
export const verifyEmailRequestSchema = z.object({
  token: z.string().min(1).max(512),
});

export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

/** Asking for a password reset link. */
export const passwordResetRequestSchema = z.object({
  email: z.email().max(320),
});

export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;

/** Completing a password reset with the emailed token. */
export const passwordResetCompletionSchema = z.object({
  token: z.string().min(1).max(512),
  password: z.string().min(1).max(1024),
});

export type PasswordResetCompletion = z.infer<typeof passwordResetCompletionSchema>;

/**
 * Changing a password while signed in.
 *
 * The current password is required even though the caller is authenticated: an
 * access token that has been left behind on a shared device should not be
 * enough to take an account over.
 */
export const passwordChangeRequestSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(1).max(1024),
});

export type PasswordChangeRequest = z.infer<typeof passwordChangeRequestSchema>;

/** Redeeming a login link for a Session. */
export const createSessionRequestSchema = z.object({
  token: z.string().min(1).max(512),
});

export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

/** Exchanging a refresh credential for a new pair. */
export const refreshSessionRequestSchema = z.object({
  refreshToken: z.string().min(1).max(512),
});

export type RefreshSessionRequest = z.infer<typeof refreshSessionRequestSchema>;

/**
 * Newly issued credentials.
 *
 * The refresh token is returned once, at issuance, and is not retrievable
 * afterwards: only its hash is retained.
 */
export const sessionCredentialsSchema = z.object({
  sessionId: identifierSchema,
  accessToken: z.string(),
  accessTokenExpiresAt: timestampSchema,
  refreshToken: z.string(),
  refreshTokenExpiresAt: timestampSchema,
});

export type SessionCredentials = z.infer<typeof sessionCredentialsSchema>;

/**
 * A Session as its owner sees it.
 *
 * Carries only what a person needs to recognise and revoke a session. Detailed
 * device fingerprinting is deliberately absent.
 */
export const sessionSummarySchema = z.object({
  sessionId: identifierSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  lastRefreshedAt: timestampSchema.nullable(),
  current: z.boolean(),
});

export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const sessionListSchema = z.object({
  sessions: z.array(sessionSummarySchema),
});

export type SessionList = z.infer<typeof sessionListSchema>;
