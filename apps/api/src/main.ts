// Before anything that declares an entity: TypeORM's decorators register
// themselves through the metadata reflection API, which is a polyfill rather
// than something the runtime provides.
import "reflect-metadata";

import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "./config/app-config.js";
import { connectDatabase } from "./lib/database/postgres.js";
import { composeApp } from "./server/compose.js";
import { startServer } from "./server/server.js";

/**
 * Process entry point.
 *
 * It composes the application and starts it. Routes, domain behaviour, and
 * persistence belong elsewhere; a process entry point should assemble the
 * application, not become it — and assembling now happens in `compose.ts`, so
 * that the command which writes the OpenAPI document builds the very same
 * application rather than a second wiring that could disagree with this one.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const { app, dependencies, database, email, storage } = await composeApp(config);

  // After composition, not before. Nothing between the two queries anything —
  // repositories hold the DataSource without touching it — which is what lets
  // the document be generated with no database running.
  await connectDatabase(database);

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
