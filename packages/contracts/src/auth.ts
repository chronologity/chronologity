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

export const magicLinkResponseSchema = z.object({
  message: z.string(),
});

export type MagicLinkResponse = z.infer<typeof magicLinkResponseSchema>;

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
