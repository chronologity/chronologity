import type { FastifyRequest } from "fastify";
import { ANONYMOUS } from "../../auth/auth-context.js";
import type { ReadStore } from "../../read-models/clickhouse/client.js";
import type { GraphQLContext } from "./graphql-context.js";

/**
 * Build the context one GraphQL request runs in.
 *
 * It reads rather than resolves: the Viewer was established by the
 * authentication hook before this ran, and a request that failed there never
 * reaches a resolver. This function must not throw, because Mercurius calls it
 * again from inside its error handler when a request failed before a context
 * existed — a second throw there would happen while the first was being
 * reported.
 *
 * `request.viewer` is therefore defaulted rather than asserted. The default is
 * anonymous, which is the safe direction: the only path that reaches here
 * without the hook having run is one that already failed.
 *
 * @param store - The ClickHouse boundary this instance reads through, and the
 *   projection version it reads.
 * @returns A function Mercurius calls once per request, producing the context
 *   every resolver receives.
 */
export function createContext(store: ReadStore) {
  return function contextFor(request: FastifyRequest): GraphQLContext {
    return {
      viewer: request.viewer ?? ANONYMOUS,
      traceId: request.traceId,
      // Already bound to this request, so a resolver logging a slow query
      // produces a line that can be found beside the rest of the request.
      log: request.log,
      clickhouse: store.client,
      projectionVersion: store.projectionVersion,
    };
  };
}
