import type { Env } from "./env.js";

/**
 * PostgreSQL connection settings.
 *
 * Deliberately narrow. This application asks PostgreSQL one question — does the
 * Session this token names still authenticate — because the answer changes the
 * moment somebody signs out and a token cannot carry that. Everything else it
 * reads comes from ClickHouse, and `feed.md:321` is explicit that ordinary
 * Timeline reads must never touch the authoritative tables.
 *
 * A deployment should issue a role that can only SELECT. There is nothing here
 * this service is entitled to write.
 */
export interface DatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

/**
 * Derive PostgreSQL settings from the environment.
 *
 * @param env - The validated environment.
 * @returns PostgreSQL connection settings.
 */
export function toDatabaseConfig(env: Env): DatabaseConfig {
  return {
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    database: env.POSTGRES_DATABASE,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
  };
}
