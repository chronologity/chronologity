import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "./config/app-config.js";
import { startTelemetry } from "./observability/tracing.js";
import { composeApp } from "./server/compose.js";
import { startServer } from "./server/server.js";

/**
 * Process entry point.
 *
 * It composes the application and starts it. The schema, the resolvers and the
 * queries behind them belong elsewhere; a process entry point should assemble
 * the application, not become it.
 */
async function main(): Promise<void> {
  const config = loadConfig();

  // Before anything is composed, so a span opened while the application is
  // being built has somewhere to go. Emits nothing when no endpoint is
  // configured, which is what a local run and every test want.
  const telemetry = startTelemetry(config.telemetry);
  const { app, dependencies } = await composeApp(config);

  await startServer({
    app,
    config,
    // Telemetry first, so it closes last: resources are closed in reverse, and
    // flushing before the stores have finished emitting would lose exactly the
    // spans describing the shutdown.
    resources: [{ name: "telemetry", close: () => telemetry.shutdown() }, ...dependencies],
  });

  // Connectivity is reported rather than required at startup. A service that
  // refused to boot while ClickHouse was briefly unavailable could not serve
  // liveness checks or recover on its own once it returned — and readiness
  // already tells the load balancer not to send it Timeline traffic meanwhile.
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

  app.log.info(
    {
      host: config.host,
      port: config.port,
      projectionVersion: config.clickhouse.projectionVersion,
    },
    "Feed aggregator listening",
  );
}

try {
  await main();
} catch (error) {
  if (error instanceof ConfigurationError) {
    // Configuration failures are operator errors, not crashes: print the list
    // of problems plainly rather than burying it in a stack trace.
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`Failed to start the feed aggregator: ${String(error)}\n`);
  }
  process.exit(1);
}
