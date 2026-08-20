import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "./config/app-config.js";
import { createDatabase } from "./lib/database/postgres.js";
import { createMessaging } from "./lib/messaging/kafka.js";
import { createEmailClient } from "./integrations/email/email-client.js";
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
  const messaging = createMessaging(config.messaging);
  const dependencies = [database, messaging];

  const email = createEmailClient(config.email);
  const storage = createStorageClient(config.storage);
  // Built here so the wiring is uniform, though the HTTP process never opens a
  // file: authorising and verifying an upload does not require reading it.
  const places = createPlaceSearchClient(config.places);

  const accounts = new UserRepository(database.pool);

  // Sessions are built before identities because proving who someone is ends in
  // granting them one: the dependency runs that way and only that way.
  const sessions = new SessionService(
    database.pool,
    new SessionRepository(database.pool),
    accounts,
    config.auth,
  );

  const app = await buildApp({
    config,
    dependencies,
    authentication: {
      identities: new IdentityService(
        database.pool,
        new IdentityRepository(database.pool),
        sessions,
        email,
        config.auth,
      ),
      sessions,
      config: config.auth,
      pool: database.pool,
    },
    users: new UserService(database.pool, accounts, {
      minimumAgeYears: config.minimumAgeYears,
    }),
    authorization: new AuthorizationService(
      database.pool,
      new AuthorizationRepository(database.pool),
    ),
    uploads: new UploadService(
      database.pool,
      new UploadRepository(database.pool),
      storage,
      config.uploadLimits,
    ),
    locations: new LocationService(database.pool, new LocationRepository(database.pool), places),
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
