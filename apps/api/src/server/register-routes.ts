import type { FastifyInstance } from "fastify";
import { authRoutes } from "../features/auth/routes/auth.routes.js";
import type { AuthDependencies } from "../features/auth/index.js";
import { healthRoutes } from "../features/health/index.js";

/**
 * Compose feature route modules.
 *
 * Individual operations are registered by the feature that owns them; this
 * file only decides which features are mounted, and where.
 *
 * @param app - The instance to mount on.
 * @param auth - Authentication wiring; when absent the auth routes are skipped.
 * @returns Nothing.
 */
export async function registerRoutes(
  app: FastifyInstance,
  auth?: AuthDependencies | undefined,
): Promise<void> {
  await app.register(healthRoutes);

  if (auth !== undefined) {
    await app.register(authRoutes(auth));
  }
}
