import type { Env } from "./env.js";

/**
 * How the GraphQL surface is bounded and exposed.
 *
 * Depth is the only cost control this phase carries. Field weighting and a
 * total complexity budget belong with the queries they would be weighting, and
 * those do not exist yet; a budget invented against a two-type schema would be
 * a number nobody could defend. Depth is different: it is a structural bound,
 * it costs nothing to enforce, and the reciprocal edges it protects against are
 * the first thing Phase 9 adds.
 */
export interface GraphQLConfig {
  /** How deep a document may nest before it is refused. */
  readonly maxDepth: number;
  /**
   * Whether the in-browser explorer is served.
   *
   * Off in production. It is a development convenience, and publishing an
   * interactive query console beside a Timeline is an invitation to probe it.
   */
  readonly graphiql: boolean;
}

/**
 * Derive GraphQL settings from the environment.
 *
 * @param env - The validated environment.
 * @returns The depth bound, and whether to serve the explorer.
 */
export function toGraphQLConfig(env: Env): GraphQLConfig {
  return {
    maxDepth: env.FEED_AGGREGATOR_GRAPHQL_MAX_DEPTH,
    graphiql: env.NODE_ENV !== "production",
  };
}
