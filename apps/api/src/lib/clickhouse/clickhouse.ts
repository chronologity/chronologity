import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseConfig } from "../../config/clickhouse-config.js";
import type { HealthCheckable } from "../health.js";

/**
 * The API's ClickHouse infrastructure boundary.
 *
 * ClickHouse holds Timeline read models and nothing authoritative. Every row in
 * it is derived from PostgreSQL and can be rebuilt from PostgreSQL, which is
 * what makes it safe to drop a projection version and build another beside it —
 * and what makes losing this store an availability problem rather than a data
 * one (ADR-055).
 *
 * Shaped like `lib/database/postgres.ts`, deliberately. Construction is separate
 * from connection so a configuration error surfaces before any I/O; the health
 * check performs a real query rather than reporting that an object exists; and
 * one client belongs to the process rather than one per caller.
 */
export interface Analytics extends HealthCheckable {
  readonly client: ClickHouseClient;
  close(): Promise<void>;
}

/**
 * Build the ClickHouse boundary.
 *
 * @param config - Where the server is, and which database and credentials to
 *   use.
 * @returns The client, a health check that performs a real query, and a close.
 *   Returned unconnected: the client opens its first connection lazily, so this
 *   can be built without a server present.
 */
export function createAnalytics(config: ClickHouseConfig): Analytics {
  const client = createClient({
    url: config.url,
    database: config.database,
    username: config.username,
    password: config.password,
    // Bounded so a failing dependency surfaces as an error rather than as a
    // request that hangs until something upstream gives up, matching the
    // relational boundary's five seconds.
    request_timeout: 30_000,
    clickhouse_settings: {
      // Reads of a `ReplacingMergeTree` must collapse duplicate rows, and this
      // projection is one. Deduplication otherwise happens only when parts
      // merge, which is to say at a time nobody controls — so a Timeline read
      // taken between an update and a merge would show the same Moment twice.
      // Set here rather than per query, because remembering `FINAL` at every
      // call site is not a control.
      final: 1,
    },
  });

  return {
    name: "clickhouse",
    client,
    async checkHealth() {
      const result = await client.query({ query: "SELECT 1", format: "JSONEachRow" });
      await result.json();
    },
    async close() {
      await client.close();
    },
  };
}
