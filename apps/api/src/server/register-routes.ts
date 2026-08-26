import type { FastifyInstance } from "fastify";
import { authenticationRoutes } from "../features/authentication/authentication.routes.js";
import type { AuthenticationWiring } from "../features/authentication/authentication.types.js";
import { authorizationRoutes } from "../features/authorization/authorization.routes.js";
import type { AuthorizationService } from "../features/authorization/authorization.service.js";
import { healthRoutes } from "../features/health/index.js";
import { moderationRoutes } from "../features/moderation/moderation.routes.js";
import type { ModerationService } from "../features/moderation/moderation.service.js";
import { locationRoutes } from "../features/locations/location.routes.js";
import type { LocationService } from "../features/locations/location.service.js";
import { followRoutes } from "../features/social/follow.routes.js";
import type { FollowService } from "../features/social/follow.service.js";
import { momentRoutes } from "../features/moments/moment.routes.js";
import type { MomentCommentService } from "../features/moments/moment-comment.service.js";
import type { MomentReactionService } from "../features/moments/moment-reaction.service.js";
import type { MomentSignificanceService } from "../features/moments/moment-significance.service.js";
import type { MomentRelationshipService } from "../features/moments/moment-relationship.service.js";
import type { MomentService } from "../features/moments/moment.service.js";
import { realWorldEventRoutes } from "../features/real-world-events/real-world-event.routes.js";
import type { RealWorldEventService } from "../features/real-world-events/real-world-event.service.js";
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
 * @param realWorldEvents - The real-world Event service; mounted only alongside
 *   users, since recording an occurrence requires an account.
 * @param moments - The Moment service; mounted only alongside users, since a
 *   Moment belongs to whoever recorded it.
 * @param momentRelationships - Claims connecting Moments; mounted only
 *   alongside the Moment service, whose visibility check every relationship
 *   read depends on.
 * @param momentReactions - Responses to Moments; mounted only alongside the
 *   Moment service, whose visibility check every reaction read depends on.
 * @param momentComments - Discussion about Moments; mounted only alongside the
 *   Moment service, whose visibility check bounds every comment read.
 * @param momentSignificance - Saying a Moment matters to you; mounted only
 *   alongside the Moment service, whose visibility check bounds every mark.
 * @param follows - The follow service; mounted only alongside users, since
 *   following is a relationship between two accounts.
 * @param moderation - Reporting, moderating, suspending, and appealing; mounted
 *   only alongside users, since every report, decision, and appeal names one.
 * @returns Nothing.
 */
export async function registerRoutes(
  app: FastifyInstance,
  authentication?: AuthenticationWiring | undefined,
  users?: UserService | undefined,
  authorization?: AuthorizationService | undefined,
  uploads?: UploadService | undefined,
  locations?: LocationService | undefined,
  realWorldEvents?: RealWorldEventService | undefined,
  moments?: MomentService | undefined,
  momentRelationships?: MomentRelationshipService | undefined,
  momentReactions?: MomentReactionService | undefined,
  momentComments?: MomentCommentService | undefined,
  momentSignificance?: MomentSignificanceService | undefined,
  follows?: FollowService | undefined,
  moderation?: ModerationService | undefined,
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

      if (realWorldEvents !== undefined) {
        await app.register(realWorldEventRoutes(realWorldEvents));
      }

      if (moments !== undefined) {
        await app.register(momentRoutes(
            moments,
            momentRelationships,
            momentReactions,
            momentComments,
            momentSignificance,
          ));
      }

      if (follows !== undefined) {
        await app.register(followRoutes(follows));
      }

      if (moderation !== undefined) {
        await app.register(moderationRoutes(moderation));
      }
    }
  }
}
