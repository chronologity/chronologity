import type { FastifyInstance } from "fastify";
import { authRoutes } from "../features/auth/routes/auth.routes.js";
import type { AuthDependencies } from "../features/auth/index.js";
import {
  authorizationRoutes,
  type AuthorizationDependencies,
} from "../features/authorization/index.js";
import { healthRoutes } from "../features/health/index.js";
import { locationRoutes, type LocationDependencies } from "../features/locations/index.js";
import { uploadRoutes, type UploadDependencies } from "../features/uploads/index.js";
import { userRoutes, type UserDependencies } from "../features/users/index.js";

/**
 * Compose feature route modules.
 *
 * Individual operations are registered by the feature that owns them; this
 * file only decides which features are mounted, and where.
 *
 * @param app - The instance to mount on.
 * @param auth - Authentication wiring; when absent the auth routes are skipped.
 * @param users - User wiring; mounted only alongside auth.
 * @param authorization - Authorization wiring; mounted only alongside users,
 *   since every role belongs to a User.
 * @param uploads - Upload wiring; mounted only alongside users, since every
 *   upload belongs to a User.
 * @param locations - Location wiring; mounted only alongside users, since
 *   recording a place requires an account.
 * @returns Nothing.
 */
export async function registerRoutes(
  app: FastifyInstance,
  auth?: AuthDependencies | undefined,
  users?: UserDependencies | undefined,
  authorization?: AuthorizationDependencies | undefined,
  uploads?: UploadDependencies | undefined,
  locations?: LocationDependencies | undefined,
): Promise<void> {
  await app.register(healthRoutes);

  if (auth !== undefined) {
    await app.register(authRoutes(auth));

    if (users !== undefined) {
      // Mounted only alongside auth: every User route needs an authenticated
      // caller, and account creation needs the Identity auth establishes.
      await app.register(userRoutes(users, auth));

      if (authorization !== undefined) {
        await app.register(authorizationRoutes(authorization));
      }

      if (uploads !== undefined) {
        await app.register(uploadRoutes(uploads));
      }

      if (locations !== undefined) {
        await app.register(locationRoutes(locations));
      }
    }
  }
}
