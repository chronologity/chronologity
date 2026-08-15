import { magicLinkRequestSchema, magicLinkResponseSchema } from "@chronologity/contracts";

/**
 * Route schemas for requesting a sign-in link.
 *
 * Re-exported from the contracts package rather than redefined: the API must
 * validate against the same definition clients compile against, or the two
 * drift and only the client finds out.
 */
export const magicLinkBodySchema = magicLinkRequestSchema;
export const magicLinkResponseBodySchema = magicLinkResponseSchema;

/**
 * Deliberately identical whether or not the address is known
 * (`authentication.md:951`).
 */
export const MAGIC_LINK_RESPONSE = {
  message: "If an eligible account exists, sign-in instructions have been sent.",
};
