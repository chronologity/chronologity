import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { SessionLookup } from "../auth/session.repository.js";
import type { AppConfig } from "../config/app-config.js";
import { AggregatorError } from "../errors/aggregator-error.js";
import { loggerOptions } from "../observability/logger.js";
import type { ReadStore } from "../read-models/clickhouse/client.js";
import type { HealthCheckable } from "./health.js";
import { healthRoutes } from "./health.routes.js";
import { registerGraphql } from "./register-graphql.js";
import { registerPlugins } from "./register-plugins.js";

declare module "fastify" {
  interface FastifyInstance {
    /** Infrastructure dependencies this instance requires to serve traffic. */
    dependencies: readonly HealthCheckable[];
  }
}

export interface BuildAppOptions {
  readonly config: AppConfig;
  /**
   * Infrastructure this instance depends on.
   *
   * Injected rather than constructed here so tests can build a fully wired
   * application without a database, and so a test can make a dependency fail
   * on purpose — which is the only way to prove readiness reports it.
   */
  readonly dependencies: readonly HealthCheckable[];
  /**
   * The GraphQL surface and the stores behind it.
   *
   * Optional so a test can build an application without it. Health checks and
   * error mapping do not need a schema, and the tests for them should not have
   * to provide two stores to exercise a readiness probe.
   */
  readonly graphql?:
    | {
        readonly store: ReadStore;
        readonly sessions: SessionLookup;
      }
    | undefined;
}

/**
 * Build the application without binding a port.
 *
 * Construction is separate from process startup so that integration tests use
 * Fastify injection instead of real sockets. A test suite that needs a free
 * port is a test suite that fails in parallel.
 *
 * @param options - Configuration, the infrastructure this instance depends on,
 *   and optionally the GraphQL surface and the stores behind it.
 * @returns The application, ready to inject into or to bind to a port.
 */
export async function buildApp({
  config,
  dependencies,
  graphql,
}: BuildAppOptions): Promise<FastifyInstance> {
  // Typed explicitly: Fastify's overloads otherwise resolve a broadly-typed
  // `logger` to the HTTP/2 signature, and every later use of the instance
  // then fails to match the default HTTP one.
  const options: FastifyServerOptions = {
    logger: loggerOptions(config),
    // Trust the platform's forwarding headers only where a proxy is actually
    // in front of the service.
    trustProxy: config.nodeEnv === "production",
  };

  const app = Fastify(options);

  app.decorate("dependencies", dependencies);

  // The envelope for everything that is not GraphQL. Mercurius installs its own
  // handler inside its scope, so a query failure is shaped like GraphQL while a
  // health check or an unknown path is shaped like the API's replies.
  app.setErrorHandler((error, request, reply) => {
    const describable = error instanceof AggregatorError;
    const status = describable ? error.status : 500;

    if (status >= 500) {
      request.log.error({ err: error, traceId: request.traceId }, "Request failed");
    } else {
      request.log.info({ err: error, traceId: request.traceId }, "Request rejected");
    }

    return reply.status(status).send({
      code: describable ? error.code : ("INTERNAL_ERROR" as const),
      // Only errors written to be shown contribute a message. Everything else
      // is linked to its real detail by the trace identifier alone.
      message: describable ? error.message : "An unexpected error occurred",
      traceId: request.traceId,
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      code: "NOT_FOUND" as const,
      message: "Route not found",
      traceId: request.traceId,
    }),
  );

  await registerPlugins(app, { graphiql: config.graphql.graphiql });
  await app.register(healthRoutes);

  // Mounted only when the stores behind it were provided. A schema with no
  // store to read is a surface that answers questions it cannot answer.
  if (graphql !== undefined) {
    await registerGraphql(app, {
      config: config.graphql,
      auth: config.auth,
      sessions: graphql.sessions,
      store: graphql.store,
    });
  }

  return app;
}
