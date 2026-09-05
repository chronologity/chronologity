import type { Env } from "./env.js";

/**
 * What this application knows about Search, which is deliberately almost
 * nothing.
 *
 * `architecture/search.md:65` gives retrieval, ranking, suggestion and indexing
 * to `apps/api` and leaves this application one job: resolving a selected result
 * into Timeline context. So the only Search fact it holds is which index version
 * to ask about — no store of its own, no query syntax, no ranking policy, and no
 * copy of the eligibility rule that decides what a search may return.
 */
export interface SearchConfig {
  /**
   * Which index version this process asks about.
   *
   * Read-only here, like the projection version and for the same reason: two
   * versions coexist while a rebuild runs, and naming one the API is not serving
   * would answer about an index nobody reads.
   */
  readonly indexVersion: string;
}

/**
 * Derive Search settings from the environment.
 *
 * @param env - The validated environment.
 * @returns Which index version to ask about.
 */
export function toSearchConfig(env: Env): SearchConfig {
  return { indexVersion: env.SEARCH_INDEX_VERSION };
}
