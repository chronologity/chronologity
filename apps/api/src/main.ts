// Before anything that declares an entity: TypeORM's decorators register
// themselves through the metadata reflection API, which is a polyfill rather
// than something the runtime provides.
import "reflect-metadata";

import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "./config/app-config.js";
import { connectDatabase, createDatabase } from "./lib/database/postgres.js";
import { createMessaging } from "./lib/messaging/kafka.js";
import { createEmailClient } from "./integrations/email/email-client.js";
import { createEmbeddedLocationClient } from "./integrations/metadata/embedded-location-client.js";
import { createStorageClient } from "./integrations/storage/storage-client.js";
import { createPlaceSearchClient } from "./integrations/places/place-search-client.js";
import { loadBreachedPasswordIndex } from "./lib/auth/breached-passwords.js";
import { IdentityRepository } from "./features/authentication/identity.repository.js";
import { IdentityService } from "./features/authentication/identity.service.js";
import { SessionRepository } from "./features/authentication/session.repository.js";
import { SessionService } from "./features/authentication/session.service.js";
import { AuthorizationRepository } from "./features/authorization/authorization.repository.js";
import { AuthorizationService } from "./features/authorization/authorization.service.js";
import { LocationRepository } from "./features/locations/location.repository.js";
import { LocationService } from "./features/locations/location.service.js";
import { MomentRepository } from "./features/moments/moment.repository.js";
import { MomentService } from "./features/moments/moment.service.js";
import { RealWorldEventRepository } from "./features/real-world-events/real-world-event.repository.js";
import { RealWorldEventService } from "./features/real-world-events/real-world-event.service.js";
import { UploadRepository } from "./features/uploads/upload.repository.js";
import { UploadService } from "./features/uploads/upload.service.js";
import { UserRepository } from "./features/users/user.repository.js";
import { UserService } from "./features/users/user.service.js";
import { buildApp } from "./server/app.js";
import { startServer } from "./server/server.js";

/**
 * Process entry point.
 *
 * It composes the application and starts it. Routes, domain behaviour, and
 * persistence belong elsewhere; a process entry point should assemble the
 * application, not become it.
 */
async function main(): Promise<void> {
  const config = loadConfig();

  // Loaded before anything serves traffic: a missing index is a broken build,
  // and discovering that on someone's first registration would mean the check
  // had been silently absent until then.
  loadBreachedPasswordIndex();

  const database = createDatabase(config.database);

  await connectDatabase(database);
  const messaging = createMessaging(config.messaging);
  const dependencies = [database, messaging];

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

  // Sessions are built before identities because proving who someone is ends in
  // granting them one: the dependency runs that way and only that way.
  const sessions = new SessionService(
    database.dataSource,
    new SessionRepository(database.dataSource),
    accounts,
    config.auth,
  );

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
      ),
      sessions,
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
    moments: new MomentService(
      database.dataSource,
      new MomentRepository(database.dataSource),
      uploadRepository,
    ),
    realWorldEvents: new RealWorldEventService(
      database.dataSource,
      new RealWorldEventRepository(database.dataSource),
      locationRepository,
    ),
  });

  await startServer({
    app,
    config,
    resources: [
      ...dependencies,
      { name: "email", close: () => email.close() },
      { name: "storage", close: async () => storage.close() },
    ],
  });

  // Connectivity is reported rather than required at startup. An API that
  // refuses to boot while a dependency is briefly unavailable cannot serve
  // liveness checks or recover on its own once the dependency returns.
  for (const dependency of dependencies) {
    try {
      await dependency.checkHealth();
      app.log.info({ dependency: dependency.name }, "Dependency reachable");
    } catch (error) {
      app.log.warn(
        { err: error, dependency: dependency.name },
        "Dependency unreachable at startup",
      );
    }
  }

  app.log.info({ host: config.host, port: config.port }, "API listening");
}

try {
  await main();
} catch (error) {
  if (error instanceof ConfigurationError) {
    // Configuration failures are operator errors, not crashes: print the list
    // of problems plainly rather than burying it in a stack trace.
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`Failed to start API: ${String(error)}\n`);
  }
  process.exit(1);
}
