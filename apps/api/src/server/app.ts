import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { AppConfig } from "../config/app-config.js";
import { toErrorResponse } from "../lib/errors/to-error-response.js";
import type { HealthCheckable } from "../lib/health.js";
import { loggerOptions } from "../lib/logger/logger.js";
import type { AuthenticationWiring } from "../features/authentication/authentication.types.js";
import type { AuthorizationService } from "../features/authorization/authorization.service.js";
import type { LocationService } from "../features/locations/location.service.js";
import type { MomentCommentService } from "../features/moments/moment-comment.service.js";
import type { MomentReactionService } from "../features/moments/moment-reaction.service.js";
import type { MomentSignificanceService } from "../features/moments/moment-significance.service.js";
import type { MomentRelationshipService } from "../features/moments/moment-relationship.service.js";
import type { MomentService } from "../features/moments/moment.service.js";
import type { FollowService } from "../features/social/follow.service.js";
import type { ParticipationService } from "../features/participation/participation.service.js";
import type { RealWorldEventService } from "../features/real-world-events/real-world-event.service.js";
import type { UploadService } from "../features/uploads/upload.service.js";
import type { UserService } from "../features/users/user.service.js";
import { registerPlugins } from "./register-plugins.js";
import type { ModerationService } from "../features/moderation/moderation.service.js";
import type { DiscoveryService } from "../features/discovery/discovery.service.js";
import type { TimelineService } from "../features/timeline/timeline.service.js";
import type { AccountDeletionService } from "../features/privacy/account-deletion.service.js";
import type { ExportService } from "../features/privacy/export.service.js";
import type { NotificationDeliveryService } from "../features/notifications/notification.delivery.service.js";
import type { NotificationService } from "../features/notifications/notification.service.js";
import type { SearchRateLimits } from "../features/search/search.rate-limits.js";
import type { SearchService } from "../features/search/search.service.js";
import { registerRoutes } from "./register-routes.js";

declare module "fastify" {
  interface FastifyInstance {
    /** Infrastructure dependencies this instance requires to serve traffic. */
    dependencies: readonly HealthCheckable[];
  }
}

export interface BuildAppOptions {
  config: AppConfig;
  /**
   * Infrastructure the API depends on.
   *
   * Injected rather than constructed here so tests can build a fully wired
   * application without a database, and so a test can make a dependency fail
   * on purpose — which is the only way to prove readiness reports it.
   */
  dependencies: readonly HealthCheckable[];
  /**
   * Authentication wiring.
   *
   * Optional so a test can build an application without it — health checks and
   * error mapping do not need authentication, and tests for them should not
   * have to provide a database.
   */
  authentication?: AuthenticationWiring | undefined;
  /** The User service. Mounted only alongside authentication. */
  users?: UserService | undefined;
  /** The Authorization service. Mounted only alongside users. */
  authorization?: AuthorizationService | undefined;
  /** The Upload service. Mounted only alongside users. */
  uploads?: UploadService | undefined;
  /** The Location service. Mounted only alongside users. */
  locations?: LocationService | undefined;
  /** The real-world Event service. Mounted only alongside users. */
  realWorldEvents?: RealWorldEventService | undefined;
  /** The Moment service. Mounted only alongside users. */
  moments?: MomentService | undefined;
  /** Claims connecting Moments. Mounted only alongside the Moment service. */
  momentRelationships?: MomentRelationshipService | undefined;
  /** Responses to Moments. Mounted only alongside the Moment service. */
  momentReactions?: MomentReactionService | undefined;
  /** Discussion about Moments. Mounted only alongside the Moment service. */
  momentComments?: MomentCommentService | undefined;
  /** Saying a Moment matters to you. Mounted only alongside the Moment service. */
  momentSignificance?: MomentSignificanceService | undefined;
  /** The follow service. Mounted only alongside users. */
  follows?: FollowService | undefined;
  /** Reporting, moderating, suspending, and appealing. Mounted only alongside users. */
  moderation?: ModerationService | undefined;
  /** Finding history. Mounted only alongside users, since every search has a Viewer. */
  search?: SearchService | undefined;
  /**
   * How hard the Search surfaces may be pushed.
   *
   * Injected for the reason the authentication limits are: a test that proves
   * limiting works has to reach the limit deliberately, and every other test
   * has to stay well under it.
   */
  searchRateLimits?: SearchRateLimits | undefined;
  /** Recommending history. Mounted only alongside users, since every surface has a Viewer. */
  discovery?: DiscoveryService | undefined;
  /** Navigating your own history. Mounted only alongside users. */
  timeline?: TimelineService | undefined;
  /** Telling somebody something happened. Mounted only alongside users. */
  notifications?: NotificationService | undefined;
  notificationDelivery?: NotificationDeliveryService | undefined;
  accountDeletion?: AccountDeletionService | undefined;
  dataExport?: ExportService | undefined;
  participations?: ParticipationService | undefined;
}

/**
 * Build the application without binding a port.
 *
 * Construction is separate from process startup so that integration tests use
 * Fastify injection instead of real sockets. A test suite that needs a free
 * port is a test suite that fails in parallel.
 *
 * @param options - Configuration, the infrastructure this instance depends on,
 *   and optional authentication and feature wiring.
 * @returns The application, ready to inject into or to bind to a port.
 */
export async function buildApp({
  config,
  dependencies,
  authentication,
  users,
  authorization,
  uploads,
  locations,
  realWorldEvents,
  moments,
  momentRelationships,
  momentReactions,
  momentComments,
  momentSignificance,
  follows,
  moderation,
  search,
  searchRateLimits,
  discovery,
  timeline,
  notifications,
  notificationDelivery,
  accountDeletion,
  dataExport,
  participations,
}: BuildAppOptions): Promise<FastifyInstance> {
  // Typed explicitly: Fastify's overloads otherwise resolve a broadly-typed
  // `logger` to the HTTP/2 signature, and every later use of the instance
  // then fails to match the default HTTP one.
  const options: FastifyServerOptions = {
    logger: loggerOptions(config),
    // Trust the platform's forwarding headers only where a proxy is actually
    // in front of the API.
    trustProxy: config.nodeEnv === "production",
  };

  const app = Fastify(options);

  app.decorate("dependencies", dependencies);

  app.setErrorHandler((error, request, reply) => {
    const { status, body } = toErrorResponse(error, request.traceId);

    // Log the real error at a severity matching its kind, then reply with the
    // sanitized envelope. The two are linked only by the trace identifier.
    if (status >= 500) {
      request.log.error({ err: error, traceId: request.traceId }, "Request failed");
    } else {
      request.log.info({ err: error, traceId: request.traceId }, "Request rejected");
    }

    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      code: "NOT_FOUND" as const,
      message: "Route not found",
      traceId: request.traceId,
    }),
  );

  await registerPlugins(
    app,
    authentication,
    { max: config.rateLimit.maxPerMinute },
    // Absent in production rather than protected there: a document naming every
    // authentication surface is a map of the attack surface.
    { enabled: config.nodeEnv !== "production" },
  );
  await registerRoutes(
    app,
    authentication,
    users,
    authorization,
    uploads,
    locations,
    realWorldEvents,
    moments,
    momentRelationships,
    momentReactions,
    momentComments,
    momentSignificance,
    follows,
    moderation,
    search,
    searchRateLimits,
    timeline,
    discovery,
    notifications,
    notificationDelivery,
    accountDeletion,
    dataExport,
    participations,
  );

  return app;
}
