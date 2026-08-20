import type { FastifyInstance } from "fastify";
import type { AuthenticationWiring } from "../features/authentication/authentication.types.js";
import { authPlugin } from "../plugins/auth.plugin.js";
import { corsPlugin } from "../plugins/cors.plugin.js";
import { helmetPlugin } from "../plugins/helmet.plugin.js";
import { rateLimitPlugin } from "../plugins/rate-limit.plugin.js";
import { requestContextPlugin } from "../plugins/request-context.plugin.js";
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
 * @returns Nothing.
 */
export async function registerPlugins(
  app: FastifyInstance,
  authentication?: AuthenticationWiring | undefined,
): Promise<void> {
  await app.register(requestContextPlugin);
  await app.register(validationPlugin);
  await app.register(helmetPlugin);
  await app.register(corsPlugin);
  await app.register(rateLimitPlugin);

  if (authentication !== undefined) {
    await app.register(authPlugin, { deps: authentication });
  }
}
