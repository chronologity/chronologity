import type { Env } from "./env.js";

/**
 * How the GraphQL surface is bounded and exposed.
 *
 * Two bounds, answering different questions. Depth is structural: how far down
 * a document reaches, which is what protects against the reciprocal edges a
 * read schema grows. Cost is measured: how many database reads the document
 * would spend, which is what protects against a document that is shallow and
 * enormous.
 *
 * Cost arrived last, deliberately. ADR-136 declined to set one because "a
 * budget defended against a two-type schema would be a number nobody could
 * defend", and that stayed true until 9I measured what each field spends.
 */
export interface GraphQLConfig {
  /** How deep a document may nest before it is refused. */
  readonly maxDepth: number;
  /**
   * How much one document may cost, in database reads.
   *
   * The bound depth cannot express. Depth answers how far down a document
   * reaches; this answers how much it asks for, which is what the service
   * pays.
   */
  readonly maxCost: number;
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
    maxCost: env.FEED_AGGREGATOR_GRAPHQL_MAX_COST,
    graphiql: env.NODE_ENV !== "production",
  };
}
