import type { Env } from "./env.js";

/** EventStoreDB connection settings derived from the validated environment. */
export interface EventStoreConfig {
  readonly connectionString: string;
}

/**
 * Derive EventStoreDB settings from the environment.
 *
 * @param env - The validated environment.
 * @returns EventStoreDB connection settings.
 */
export function toEventStoreConfig(env: Env): EventStoreConfig {
  return { connectionString: env.EVENTSTOREDB_URL };
}
