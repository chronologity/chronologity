import "reflect-metadata";

import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/app-config.js";
import type { EmailClient } from "../integrations/email/email-client.js";
import type { StorageClient } from "../integrations/storage/storage-client.js";
import type { HealthCheckable } from "../lib/health.js";
import type { Closable } from "./server.js";
import { createDatabase, type Database } from "../lib/database/postgres.js";
import { createMessaging } from "../lib/messaging/kafka.js";
import { createEmailClient } from "../integrations/email/email-client.js";
import { createEmbeddedLocationClient } from "../integrations/metadata/embedded-location-client.js";
import { createStorageClient } from "../integrations/storage/storage-client.js";
import { createPlaceSearchClient } from "../integrations/places/place-search-client.js";
import { loadBreachedPasswordIndex } from "../lib/auth/breached-passwords.js";
import { IdentityRepository } from "../features/authentication/identity.repository.js";
import { IdentityService } from "../features/authentication/identity.service.js";
import { PhoneRepository } from "../features/authentication/phone.repository.js";
import { PhoneService } from "../features/authentication/phone.service.js";
import { createSmsClient } from "../integrations/sms/sms-client.js";
import { SessionRepository } from "../features/authentication/session.repository.js";
import { SessionService } from "../features/authentication/session.service.js";
import { AuthorizationRepository } from "../features/authorization/authorization.repository.js";
import { AuthorizationService } from "../features/authorization/authorization.service.js";
import { LocationRepository } from "../features/locations/location.repository.js";
import { ModerationRepository } from "../features/moderation/moderation.repository.js";
import { DiscoveryRetrieval } from "../features/discovery/discovery.retrieval.js";
import { createAnalytics } from "../lib/clickhouse/clickhouse.js";
import { AccountDeletionService } from "../features/privacy/account-deletion.service.js";
import { ErasureRepository } from "../features/privacy/erasure.repository.js";
import { ExportSourceRepository } from "../features/privacy/export-source.repository.js";
import { ExportRepository } from "../features/privacy/export.repository.js";
import { ExportService } from "../features/privacy/export.service.js";
import { NotificationDeliveryRepository } from "../features/notifications/notification.delivery.repository.js";
import { NotificationDeliveryService } from "../features/notifications/notification.delivery.service.js";
import { StoredRecipientDirectory } from "../features/notifications/notification.recipients.js";
import { NotificationRepository } from "../features/notifications/notification.repository.js";
import { NotificationService } from "../features/notifications/notification.service.js";
import { DiscoveryService } from "../features/discovery/discovery.service.js";
import { PostgresSearchRetrieval } from "../features/search/search.retrieval.js";
import { SearchService } from "../features/search/search.service.js";
import { ModerationService } from "../features/moderation/moderation.service.js";
import { LocationService } from "../features/locations/location.service.js";
import { FollowRepository } from "../features/social/follow.repository.js";
import { ParticipationRepository } from "../features/participation/participation.repository.js";
import { SavedViewRepository } from "../features/saved-views/saved-view.repository.js";
import { SavedViewService } from "../features/saved-views/saved-view.service.js";
import { ParticipationService } from "../features/participation/participation.service.js";
import { FollowService } from "../features/social/follow.service.js";
import { MomentRepository } from "../features/moments/moment.repository.js";
import { MomentCommentRepository } from "../features/moments/moment-comment.repository.js";
import { MomentCommentService } from "../features/moments/moment-comment.service.js";
import { MomentReactionRepository } from "../features/moments/moment-reaction.repository.js";
import { MomentSignificanceRepository } from "../features/moments/moment-significance.repository.js";
import { MomentSignificanceService } from "../features/moments/moment-significance.service.js";
import { MomentReactionService } from "../features/moments/moment-reaction.service.js";
import { MomentRelationshipRepository } from "../features/moments/moment-relationship.repository.js";
import { MomentRelationshipService } from "../features/moments/moment-relationship.service.js";
import { MomentService } from "../features/moments/moment.service.js";
import { RealWorldEventRepository } from "../features/real-world-events/real-world-event.repository.js";
import { RealWorldEventService } from "../features/real-world-events/real-world-event.service.js";
import { UploadRepository } from "../features/uploads/upload.repository.js";
import { UploadService } from "../features/uploads/upload.service.js";
import { UserRepository } from "../features/users/user.repository.js";
import { UserService } from "../features/users/user.service.js";
import { buildApp } from "./app.js";

/**
 * Assembling the application, without starting it.
 *
 * Separate from `main.ts` because two things need the fully wired application
 * and only one of them serves traffic: the process, and the command that writes
 * the OpenAPI document. Routes are registered conditionally on their services
 * being present, so a second, hand-written wiring would produce a document
 * missing whatever it forgot — silently, and differently each time somebody
 * added a service to only one of them.
 *
 * Nothing here connects to anything. `createDatabase` returns an uninitialised
 * DataSource, repositories hold the reference without querying it, and
 * registering a route never touches it. Connecting is the caller's business,
 * which is what lets the document be generated with no infrastructure running.
 */
export interface ComposedApp {
  readonly app: FastifyInstance;
  /**
   * Infrastructure whose health is reported and which the caller must close.
   *
   * Both capabilities, because the process needs each: readiness reports health,
   * and shutdown closes. A type carrying only one would make the other the
   * caller's problem to reconstruct.
   */
  readonly dependencies: readonly (HealthCheckable & Closable)[];
  readonly database: Database;
  readonly email: EmailClient;
  readonly storage: StorageClient;
}

/**
 * Wire every service and build the application.
 *
 * @param config - The validated configuration.
 * @returns The application and the infrastructure it was built against,
 *   unconnected. The caller decides whether to connect, serve, or simply read
 *   the routes back out.
 */
export async function composeApp(config: AppConfig): Promise<ComposedApp> {
  // Loaded before anything serves traffic: a missing index is a broken build,
  // and discovering that on someone's first registration would mean the check
  // had been silently absent until then.
  loadBreachedPasswordIndex();

  const database = createDatabase(config.database);

  const messaging = createMessaging(config.messaging);
  // Timeline reads come from here. Listed as a dependency so readiness asks it
  // a real question: an API serving requests it cannot answer is worse than one
  // reporting itself unready.
  const analytics = createAnalytics(config.clickhouse);
  const dependencies = [database, messaging, analytics];

  const email = createEmailClient(config.email);
  const storage = createStorageClient(config.storage);
  // Built here so the wiring is uniform, though the HTTP process never opens a
  // file: authorising and verifying an upload does not require reading it.
  const places = createPlaceSearchClient(config.places);

  const accounts = new UserRepository(database.dataSource);
  // Named because two services read through it: Locations, and real-world
  // Events checking that a place it was given actually exists.
  const locationRepository = new LocationRepository(database.dataSource);
  // Likewise: uploads owns it, and Moments read through it to check that media
  // exists, belongs to the author, and has actually been opened by a decoder.
  const uploadRepository = new UploadRepository(database.dataSource);
  // Moments check that an occurrence they name actually exists.
  const realWorldEventRepository = new RealWorldEventRepository(database.dataSource);

  // Sessions are built before identities because proving who someone is ends in
  // granting them one: the dependency runs that way and only that way.
  const sessions = new SessionService(
    database.dataSource,
    new SessionRepository(database.dataSource),
    accounts,
    config.auth,
  );

  // Shared rather than built twice: the Moment service asks it what
  // Chronologity has decided about a Moment on every read, and the moderation
  // service writes those decisions.
  const moderationRepository = new ModerationRepository(database.dataSource);

  // Shared rather than built twice: comments own it, and Moments blank every
  // comment on one when it is deleted.
  const momentCommentRepository = new MomentCommentRepository(database.dataSource);

  const savedViewRepository = new SavedViewRepository(database.dataSource);
  const moments = new MomentService(
    database.dataSource,
    new MomentRepository(database.dataSource),
    uploadRepository,
    locationRepository,
    realWorldEventRepository,
    new FollowRepository(database.dataSource),
    accounts,
    moderationRepository,
    momentCommentRepository,
    // Deleting a Moment records the erasure still owed, in the same transaction.
    // The HTTP process never performs one: erasing media is unbounded
    // object-storage work and belongs to the worker.
    new ErasureRepository(database.dataSource),
    undefined,
    // Narrowing an audience takes a Moment out of sight of whoever was dropped,
    // so what their saved views said was new is forgotten with the change.
    savedViewRepository,
  );

  const momentReactionRepository = new MomentReactionRepository(database.dataSource);
  // Shared, because blocking reaches participations and participations read
  // Blocks: two instances would be two objects over one table, which is
  // harmless until one of them grows a cache.
  const followRepository = new FollowRepository(database.dataSource);
  const participationRepository = new ParticipationRepository(database.dataSource);

  const momentSignificanceRepository = new MomentSignificanceRepository(database.dataSource);

  // Shared, because both halves of notifications read preferences through it:
  // the service that lists them and the service that decides which channels
  // carry them.
  const notificationRepository = new NotificationRepository(database.dataSource);

  const app = await buildApp({
    config,
    dependencies,
    authentication: {
      identities: new IdentityService(
        database.dataSource,
        new IdentityRepository(database.dataSource),
        sessions,
        email,
        config.auth,
        accounts,
      ),
      sessions,
      phones: new PhoneService(
        database.dataSource,
        new PhoneRepository(database.dataSource),
        new IdentityRepository(database.dataSource),
        sessions,
        createSmsClient(),
        email,
        config.auth,
        accounts,
      ),
      config: config.auth,
      dataSource: database.dataSource,
    },
    users: new UserService(database.dataSource, accounts, {
      minimumAgeYears: config.minimumAgeYears,
    }),
    authorization: new AuthorizationService(
      database.dataSource,
      new AuthorizationRepository(database.dataSource),
    ),
    uploads: new UploadService(
      database.dataSource,
      uploadRepository,
      storage,
      config.uploadLimits,
      {
        // No decoder here on purpose: this process authorises and verifies
        // uploads and never opens one. A photograph's coordinates sit in a
        // header a range read reaches, so that works; a video's live in a
        // container tag only a decoder can read, and yield nothing until a
        // deployment provides one.
        embeddedLocation: createEmbeddedLocationClient(storage),
      },
    ),
    locations: new LocationService(database.dataSource, locationRepository, places),
    moderation: new ModerationService(database.dataSource, moderationRepository),
    search: new SearchService(
      new PostgresSearchRetrieval(database.dataSource),
      moderationRepository,
    ),
    discovery: new DiscoveryService(
      new DiscoveryRetrieval(database.dataSource),
      moderationRepository,
    ),
    notifications: new NotificationService(
      database.dataSource,
      notificationRepository,
      moments,
      accounts,
      new FollowRepository(database.dataSource),
    ),
    // The HTTP process registers devices and stores delivery timing; it sends
    // nothing. Sending is the dispatcher's, so that a slow provider can never
    // hold up a request.
    // Deleting an account stops it working and writes down what is still owed.
    // Erasing what it recorded is unbounded work and belongs to the worker.
    accountDeletion: new AccountDeletionService(
      database.dataSource,
      accounts,
      new IdentityRepository(database.dataSource),
      new SessionRepository(database.dataSource),
      new PhoneRepository(database.dataSource),
      new ErasureRepository(database.dataSource),
      email,
      config.auth,
    ),
    // Asking for an export and finding out where it is. Preparing one is the
    // worker's: assembling a large history would not fit in a request.
    dataExport: new ExportService(
      database.dataSource,
      new ExportRepository(database.dataSource),
      new IdentityRepository(database.dataSource),
      new ExportSourceRepository(database.dataSource),
      storage,
      email,
      config.auth,
    ),
    notificationDelivery: new NotificationDeliveryService(
      database.dataSource,
      new NotificationDeliveryRepository(database.dataSource),
      notificationRepository,
      accounts,
      new StoredRecipientDirectory(accounts, new IdentityRepository(database.dataSource)),
    ),
    follows: new FollowService(
      database.dataSource,
      followRepository,
      accounts,
      realWorldEventRepository,
      locationRepository,
      undefined,
      // Blocking severs what two people left on each other's Moments, alongside
      // the follows and requests it already severs.
      momentReactionRepository,
      momentCommentRepository,
      participationRepository,
      // A Block narrows what each of two people sees of the other, in both
      // directions, so both sides' counts go with it.
      savedViewRepository,
    ),
    savedViews: new SavedViewService(database.dataSource, savedViewRepository, accounts),
    participations: new ParticipationService(
      database.dataSource,
      participationRepository,
      moments,
      accounts,
      followRepository,
    ),
    moments,
    momentRelationships: new MomentRelationshipService(
      database.dataSource,
      new MomentRelationshipRepository(database.dataSource),
      moments,
    ),
    momentReactions: new MomentReactionService(
      database.dataSource,
      momentReactionRepository,
      new MomentRepository(database.dataSource),
      moments,
      new FollowRepository(database.dataSource),
    ),
    momentComments: new MomentCommentService(
      database.dataSource,
      momentCommentRepository,
      new MomentRepository(database.dataSource),
      moments,
      new FollowRepository(database.dataSource),
      accounts,
    ),
    momentSignificance: new MomentSignificanceService(
      database.dataSource,
      momentSignificanceRepository,
      moments,
    ),
    realWorldEvents: new RealWorldEventService(
      database.dataSource,
      realWorldEventRepository,
      locationRepository,
      moderationRepository,
    ),
  });

  return { app, dependencies, database, email, storage };
}
