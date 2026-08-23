import rateLimit from "@fastify/rate-limit";
import fp from "fastify-plugin";

/**
 * Request rate limiting.
 *
 * Authentication endpoints set their own tighter limits; this establishes the
 * global ceiling. Limits are in-process for now, which means each replica
 * counts separately — acceptable while there is one, and a real distributed
 * limiter is a later decision that should follow a measurement rather than an
 * assumption (ADR-042).
 *
 * The response says only that too many requests were made, and never how many
 * remain, since that would tell an attacker exactly how hard to push.
 *
 * The ceiling is configuration rather than a constant. It is an operational
 * number that depends on where the process runs and how many replicas share
 * the load, and an integration suite driving one process through hundreds of
 * requests is not the traffic this defends against. The tighter per-endpoint
 * limits that actually protect authentication are unaffected by it.
 */
export interface RateLimitOptions {
  /** How many requests one client may make within the window. */
  readonly max: number;
}

export const rateLimitPlugin = fp(async (app, options: RateLimitOptions) => {
  await app.register(rateLimit, {
    global: true,
    max: options.max,
    timeWindow: "1 minute",
    addHeadersOnExceeding: { "x-ratelimit-remaining": false },
    addHeaders: { "x-ratelimit-remaining": false, "retry-after": true },
  });
});
