import type { FastifyInstance } from "fastify";
import { corsPlugin } from "../plugins/cors.plugin.js";
import { helmetPlugin } from "../plugins/helmet.plugin.js";
import { requestContextPlugin } from "../plugins/request-context.plugin.js";
import { validationPlugin } from "../plugins/validation.plugin.js";

/**
 * Install shared plugins in a deliberate order.
 *
 * Order matters: request context is established before anything that logs or
 * reports an error, so every one of them can quote a trace identifier.
 */
export async function registerPlugins(app: FastifyInstance): Promise<void> {
  await app.register(requestContextPlugin);
  await app.register(validationPlugin);
  await app.register(helmetPlugin);
  await app.register(corsPlugin);
}
