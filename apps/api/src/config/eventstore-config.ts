import type { Env } from "./env.js";

/** EventStoreDB connection settings derived from the validated environment. */
export interface EventStoreConfig {
  readonly connectionString: string;
}

export function toEventStoreConfig(env: Env): EventStoreConfig {
  return { connectionString: env.EVENTSTOREDB_URL };
}
