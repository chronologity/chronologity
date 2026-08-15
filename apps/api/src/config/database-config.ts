import type { Env } from "./env.js";

/** PostgreSQL connection settings derived from the validated environment. */
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
