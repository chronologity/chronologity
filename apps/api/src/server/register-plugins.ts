import type { FastifyInstance } from "fastify";
import type { AuthenticationWiring } from "../features/authentication/authentication.types.js";
import { authPlugin } from "../plugins/auth.plugin.js";
import { corsPlugin } from "../plugins/cors.plugin.js";
import { helmetPlugin } from "../plugins/helmet.plugin.js";
import { rateLimitPlugin, type RateLimitOptions } from "../plugins/rate-limit.plugin.js";
import { requestContextPlugin } from "../plugins/request-context.plugin.js";
import { swaggerPlugin } from "../plugins/swagger.plugin.js";
import { validationPlugin } from "../plugins/validation.plugin.js";

/**
 * Install shared plugins in a deliberate order.
 *
 * Order matters: request context is established before anything that logs or
 * reports an error, so every one of them can quote a trace identifier, and
 * rate limiting is installed before routes so their per-route limits attach.
 *
 * @param app - The instance to install on.
 * @param authentication - Authentication wiring; when absent the auth plugin is
 *   skipped, so a test can build an application without a database.
 * @param rateLimit - The global request ceiling.
 * @param documentation - Whether to publish the OpenAPI document. Registered
 *   before routes, because the document is built from the routes registered
 *   after it.
 * @returns Nothing.
 */
export async function registerPlugins(
  app: FastifyInstance,
  authentication?: AuthenticationWiring | undefined,
  rateLimit: RateLimitOptions = { max: 300 },
  documentation: { enabled: boolean } = { enabled: false },
): Promise<void> {
  await app.register(requestContextPlugin);
  await app.register(validationPlugin);
  await app.register(helmetPlugin);
  await app.register(corsPlugin);
  await app.register(rateLimitPlugin, rateLimit);
  // Before routes: the document is assembled from whatever is registered after
  // this point.
  await app.register(swaggerPlugin, documentation);

  if (authentication !== undefined) {
    await app.register(authPlugin, { deps: authentication });
  }
}
