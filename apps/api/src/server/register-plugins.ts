import type { FastifyInstance } from "fastify";
import type { AuthDependencies } from "../features/auth/index.js";
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
 */
export async function registerPlugins(
  app: FastifyInstance,
  auth?: AuthDependencies | undefined,
): Promise<void> {
  await app.register(requestContextPlugin);
  await app.register(validationPlugin);
  await app.register(helmetPlugin);
  await app.register(corsPlugin);
  await app.register(rateLimitPlugin);

  if (auth !== undefined) {
    await app.register(authPlugin, { deps: auth });
  }
}
