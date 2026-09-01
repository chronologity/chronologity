import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseConfig } from "../../config/clickhouse-config.js";
import type { HealthCheckable } from "../../server/health.js";

/**
 * The aggregator's ClickHouse boundary.
 *
 * The store every Timeline read comes from. Nothing in it is authoritative:
 * every row is derived from PostgreSQL by the API's projector and can be
 * rebuilt from it, which is what makes losing this store an availability
 * problem rather than a data one (ADR-055).
 *
 * This application only ever reads. It runs no migration and writes no row —
 * schema ownership stays with the API, and `security.md:2063` makes "the feed
 * aggregator cannot mutate ClickHouse" a credential test rather than a
 * convention. That is deliberately not enforced here by a `readonly` session
 * setting: a setting the client chooses is not a control against the client,
 * and ClickHouse's `readonly=1` would in any case refuse the `final` setting
 * below. What enforces it is the role the deployment issues.
 *
 * Construction is separate from connection so a configuration error surfaces
 * before any I/O; the health check performs a real query rather than reporting
 * that an object exists; and one client belongs to the process rather than one
 * per caller.
 */
export interface ReadStore extends HealthCheckable {
  readonly client: ClickHouseClient;
  /** Which projection version reads must name. */
  readonly projectionVersion: string;
  close(): Promise<void>;
}

/**
 * Build the ClickHouse boundary.
 *
 * @param config - Where the server is, which database and credentials to use,
 *   and which projection version this process reads.
 * @returns The client, a health check that performs a real query, and a close.
 *   Returned unconnected: the client opens its first connection lazily, so this
 *   can be built without a server present.
 */
export function createReadStore(config: ClickHouseConfig): ReadStore {
  const client = createClient({
    url: config.url,
    database: config.database,
    username: config.username,
    password: config.password,
    // Bounded so a failing dependency surfaces as an error rather than as a
    // request that hangs until something upstream gives up. Shorter than the
    // API's thirty seconds: nothing here writes or rebuilds, and a Timeline
    // read that has taken ten seconds has already failed the person waiting.
    request_timeout: 10_000,
    clickhouse_settings: {
      // Reads of a `ReplacingMergeTree` must collapse duplicate rows, and every
      // projection table is one. Deduplication otherwise happens only when
      // parts merge, which is to say at a time nobody controls — so a Timeline
      // read taken between a reprojection and a merge would show the same
      // Moment twice. Set here rather than per query, because remembering
      // `FINAL` at every call site is not a control.
      final: 1,
    },
  });

  return {
    name: "clickhouse",
    client,
    projectionVersion: config.projectionVersion,
    async checkHealth() {
      const result = await client.query({ query: "SELECT 1", format: "JSONEachRow" });
      await result.json();
    },
    async close() {
      await client.close();
    },
  };
}
