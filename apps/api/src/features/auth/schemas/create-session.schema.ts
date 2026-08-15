import {
  createSessionRequestSchema,
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
