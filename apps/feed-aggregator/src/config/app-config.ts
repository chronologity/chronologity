import { parseEnv } from "@chronologity/config";
import { toAuthConfig, type AuthConfig } from "./auth-config.js";
import { toClickHouseConfig, type ClickHouseConfig } from "./clickhouse-config.js";
import { toDatabaseConfig, type DatabaseConfig } from "./database-config.js";
import { envSchema, type Env } from "./env.js";
import { toGraphQLConfig, type GraphQLConfig } from "./graphql-config.js";
import { toSearchConfig, type SearchConfig } from "./search-config.js";

/**
 * The aggregator's fully assembled configuration.
 *
 * Assembled once at startup and passed explicitly from there. Nothing reads
 * the environment after this point.
 */
export interface AppConfig {
  readonly nodeEnv: Env["NODE_ENV"];
  readonly logLevel: Env["LOG_LEVEL"];
  readonly host: string;
  readonly port: number;
  /** Where Timeline read models live. Derived; authoritative for nothing. */
  readonly clickhouse: ClickHouseConfig;
  /**
   * Read-only, and the narrow exception `feed.md` permits. It answers whether
   * a Session is still open, what a Viewer is eligible for, a Moment read in
   * full, who stands for a span, what a context is called, and whether a found
   * thing is still findable. Its credential should be able to `SELECT` and no
   * more.
   */
  readonly database: DatabaseConfig;
  /** Verification only. This application issues no token. */
  readonly auth: AuthConfig;
  readonly graphql: GraphQLConfig;
  /** Which Search index to ask whether a found thing is still findable. */
  readonly search: SearchConfig;
}

/**
 * Load configuration, failing fast when the environment is invalid.
 *
 * @param source - Where to read from. Defaults to the process environment;
 *   injectable so tests need not mutate it.
 * @returns The assembled configuration.
 * @throws {ConfigurationError} If anything is missing or invalid, listing every
 *   problem at once. The process is expected to exit rather than start in an
 *   unknown state — a read service that starts pointing at the wrong ClickHouse
 *   serves somebody else's history rather than failing.
 */
export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const env = parseEnv(envSchema, source);

  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    host: env.FEED_AGGREGATOR_HOST,
    port: env.FEED_AGGREGATOR_PORT,
    clickhouse: toClickHouseConfig(env),
    database: toDatabaseConfig(env),
    auth: toAuthConfig(env),
    graphql: toGraphQLConfig(env),
    search: toSearchConfig(env),
  };
}
