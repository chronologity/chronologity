import type { FastifyInstance } from "fastify";
import { TimelineEligibilityResolver } from "@chronologity/timeline-derivation";
import { SessionRepository } from "../auth/session.repository.js";
import type { AppConfig } from "../config/app-config.js";
import { createReadStore, type ReadStore } from "../read-models/clickhouse/client.js";
import { createDirectory, type Directory } from "../read-models/postgres/client.js";
import { asQueryable } from "../read-models/postgres/queryable.js";
import { buildApp } from "./app.js";
import type { HealthCheckable } from "./health.js";
import type { Closable } from "./server.js";

/**
 * Assembling the application, without starting it.
 *
 * Nothing here connects to anything. The ClickHouse client opens its first
 * connection lazily, `pg` opens one on first query, and a repository holds a
 * pool without touching it. Connecting is the caller's business — which is what
 * lets a configuration mistake surface before any I/O, and lets the application
 * be built in a test that has no infrastructure at all.
 *
 * Small, and it should stay small. This service composes reads; if this file
 * ever grows the shape of `apps/api/src/server/compose.ts`, with dozens of
 * services wired into one another, something that belongs on the write side has
 * moved here.
 */
export interface ComposedApp {
  readonly app: FastifyInstance;
  /**
   * The stores whose health is reported and which the caller must close.
   *
   * Both capabilities, because the process needs each: readiness reports health,
   * and shutdown closes. A type carrying only one would make the other the
   * caller's problem to reconstruct.
   */
  readonly dependencies: readonly (HealthCheckable & Closable)[];
  readonly store: ReadStore;
  readonly directory: Directory;
}

/**
 * Wire the stores and build the application.
 *
 * @param config - The validated configuration.
 * @returns The application and the stores it was built against, unconnected.
 */
export async function composeApp(config: AppConfig): Promise<ComposedApp> {
  // Where history is read from. Listed as a dependency so readiness asks it a
  // real question: this service can answer nothing without it, and an instance
  // advertising itself as ready would be one the load balancer keeps sending
  // Timeline requests to.
  const store = createReadStore(config.clickhouse);

  // Where "is this Session still open" is answered. Also a dependency, for a
  // less obvious reason: without it every request with a credential is refused,
  // which would look to a client like everybody being signed out at once.
  const directory = createDirectory(config.database);

  const app = await buildApp({
    config,
    dependencies: [store, directory],
    graphql: {
      store,
      sessions: new SessionRepository(directory.pool),
      // The same rule the API applies, from the same package, over this
      // application's own pool.
      eligibility: new TimelineEligibilityResolver(asQueryable(directory.pool)),
    },
  });

  return { app, dependencies: [store, directory], store, directory };
}
