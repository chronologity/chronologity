import type { FastifyInstance } from "fastify";
import { authenticationRoutes } from "../features/authentication/authentication.routes.js";
import type { AuthenticationWiring } from "../features/authentication/authentication.types.js";
import { authorizationRoutes } from "../features/authorization/authorization.routes.js";
import type { AuthorizationService } from "../features/authorization/authorization.service.js";
import { healthRoutes } from "../features/health/index.js";
import { locationRoutes } from "../features/locations/location.routes.js";
import type { LocationService } from "../features/locations/location.service.js";
import { uploadRoutes } from "../features/uploads/upload.routes.js";
import type { UploadService } from "../features/uploads/upload.service.js";
import { userRoutes } from "../features/users/user.routes.js";
import type { UserService } from "../features/users/user.service.js";

/**
 * Compose feature route modules.
 *
 * Individual operations are registered by the feature that owns them; this
 * file only decides which features are mounted, and where.
 *
 * @param app - The instance to mount on.
 * @param authentication - Authentication wiring; when absent the authentication
 *   routes are skipped.
 * @param users - The User service; mounted only alongside authentication.
 * @param authorization - The Authorization service; mounted only alongside users,
 *   since every role belongs to a User.
 * @param uploads - The Upload service; mounted only alongside users, since every
 *   upload belongs to a User.
 * @param locations - The Location service; mounted only alongside users,
 *   since recording a place requires an account.
 * @returns Nothing.
 */
export async function registerRoutes(
  app: FastifyInstance,
  authentication?: AuthenticationWiring | undefined,
  users?: UserService | undefined,
  authorization?: AuthorizationService | undefined,
  uploads?: UploadService | undefined,
  locations?: LocationService | undefined,
): Promise<void> {
  await app.register(healthRoutes);

  if (authentication !== undefined) {
    await app.register(authenticationRoutes(authentication));

    if (users !== undefined) {
      // Mounted only alongside authentication: every User route needs an
      // authenticated caller, and account creation needs the Identity that
      // authentication establishes.
      await app.register(userRoutes(users, authentication));

      if (authorization !== undefined) {
        await app.register(authorizationRoutes(authorization));
      }

      if (uploads !== undefined) {
        await app.register(uploadRoutes(uploads, locations));
      }

      if (locations !== undefined) {
        await app.register(locationRoutes(locations));
      }
    }
  }
}
