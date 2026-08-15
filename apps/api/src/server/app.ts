import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { AppConfig } from "../config/app-config.js";
import { toErrorResponse } from "../lib/errors/to-error-response.js";
import type { HealthCheckable } from "../lib/health.js";
import { loggerOptions } from "../lib/logger/logger.js";
import { registerPlugins } from "./register-plugins.js";
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
}

/**
 * Build the application without binding a port.
 *
 * Construction is separate from process startup so that integration tests use
 * Fastify injection instead of real sockets. A test suite that needs a free
 * port is a test suite that fails in parallel.
 */
export async function buildApp({
  config,
  dependencies,
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

  await registerPlugins(app);
  await registerRoutes(app);

  return app;
}
