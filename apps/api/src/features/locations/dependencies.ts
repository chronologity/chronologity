import type { EventStoreDBClient } from "@eventstore/db-client";
import type pg from "pg";
import type { PlaceSearchClient } from "../../integrations/places/place-search-client.js";
import type { Logger } from "../../lib/logger/logger.js";

/**
 * What Location handlers need from the outside world.
 *
 * Passed to each handler rather than resolved from a container, so a handler's
 * dependencies are visible in its signature.
 */
export interface LocationDependencies {
  readonly client: EventStoreDBClient;
  readonly pool: pg.Pool;
  /** Looks places up. Swapped for recorded answers in tests. */
  readonly places: PlaceSearchClient;
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
export function clockFor(deps: LocationDependencies): () => Date {
  return deps.clock ?? (() => new Date());
}
