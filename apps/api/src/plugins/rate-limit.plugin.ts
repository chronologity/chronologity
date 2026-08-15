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
 */
export const rateLimitPlugin = fp(async (app) => {
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    addHeadersOnExceeding: { "x-ratelimit-remaining": false },
    addHeaders: { "x-ratelimit-remaining": false, "retry-after": true },
  });
});
