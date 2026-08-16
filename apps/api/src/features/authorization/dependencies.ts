import type { EventStoreDBClient } from "@eventstore/db-client";
import type pg from "pg";
import type { Logger } from "../../lib/logger/logger.js";

/**
 * What authorization handlers need from the outside world.
 *
 * Passed to each handler rather than resolved from a container, so a handler's
 * dependencies are visible in its signature.
 */
export interface AuthorizationDependencies {
  readonly client: EventStoreDBClient;
  readonly pool: pg.Pool;
  readonly logger?: Logger;
  /** Injected so tests can move time without waiting. */
  readonly clock?: () => Date;
}

/**
 * The clock a handler should use.
 *
 * @param deps - May carry an injected clock.
 * @returns The clock to read time from.
 */
export function clockFor(deps: AuthorizationDependencies): () => Date {
  return deps.clock ?? (() => new Date());
}
