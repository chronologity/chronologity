import type { Env } from "./env.js";

/**
 * Where the Timeline read models live.
 *
 * This application's primary store, and the only one it reads history from.
 * Nothing in ClickHouse is authoritative: every row is derived from PostgreSQL
 * and can be rebuilt from it, which is what makes losing this store an
 * availability problem rather than a data one (ADR-055).
 */
export interface ClickHouseConfig {
  /** The HTTP endpoint, including scheme and port. */
  readonly url: string;
  readonly database: string;
  readonly username: string;
  readonly password: string;
  /**
   * Which projection version this process reads.
   *
   * Read-only here, unlike in the API, which reads and writes one value.
   * Nothing in this application projects, so there is no second version it
   * could drift from — only the risk of naming one the API is not maintaining.
   */
  readonly projectionVersion: string;
}

/**
 * Derive ClickHouse settings from the environment.
 *
 * @param env - The validated environment.
 * @returns Where to read Timeline projections, and which version.
 */
export function toClickHouseConfig(env: Env): ClickHouseConfig {
  return {
    url: env.CLICKHOUSE_URL,
    database: env.CLICKHOUSE_DATABASE,
    username: env.CLICKHOUSE_USERNAME,
    password: env.CLICKHOUSE_PASSWORD,
    projectionVersion: env.TIMELINE_PROJECTION_VERSION,
  };
}
