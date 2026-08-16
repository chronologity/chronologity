import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "./config/app-config.js";
import { createDatabase } from "./lib/database/postgres.js";
import { createEventStore } from "./lib/eventstore/client.js";
import { createMessaging } from "./lib/messaging/kafka.js";
import { createEmailClient } from "./integrations/email/email-client.js";
import { createStorageClient } from "./integrations/storage/storage-client.js";
import { createMetadataClient } from "./integrations/metadata/metadata-client.js";
import { loadBreachedPasswordIndex } from "./lib/auth/breached-passwords.js";
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
  const eventStore = createEventStore(config.eventStore);
  const messaging = createMessaging(config.messaging);
  const dependencies = [database, eventStore, messaging];

  const email = createEmailClient(config.email);
  const storage = createStorageClient(config.storage);
  // Built here so the wiring is uniform, though the HTTP process never opens a
  // file: authorising and verifying an upload does not require reading it.
  const metadata = createMetadataClient();

  const app = await buildApp({
    config,
    dependencies,
    auth: {
      client: eventStore.client,
      pool: database.pool,
      config: config.auth,
      email,
    },
    users: {
      client: eventStore.client,
      pool: database.pool,
      minimumAgeYears: config.minimumAgeYears,
    },
    authorization: {
      client: eventStore.client,
      pool: database.pool,
    },
    uploads: {
      client: eventStore.client,
      pool: database.pool,
      storage,
      metadata,
      limits: config.uploadLimits,
    },
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
