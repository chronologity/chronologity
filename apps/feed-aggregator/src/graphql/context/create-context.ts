import type { FastifyRequest } from "fastify";
import { ANONYMOUS } from "../../auth/auth-context.js";
import type { TimelineEligibilityResolver } from "@chronologity/timeline-derivation";
import { RequestEligibility } from "../../auth/request-eligibility.js";
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
 * @param eligibility - The shared resolver. Wrapped per request rather than
 *   used directly, so that what a Viewer may see is decided once per scope for
 *   the length of one response.
 * @returns A function Mercurius calls once per request, producing the context
 *   every resolver receives.
 */
export function createContext(store: ReadStore, eligibility: TimelineEligibilityResolver) {
  return function contextFor(request: FastifyRequest): GraphQLContext {
    const viewer = request.viewer ?? ANONYMOUS;

    return {
      viewer,
      // Built per request and never shared. Nothing is resolved yet: a query
      // that reads no history — `viewer`, say — should pay for none of it.
      eligibility: new RequestEligibility(eligibility, viewer),
      traceId: request.traceId,
      // Already bound to this request, so a resolver logging a slow query
      // produces a line that can be found beside the rest of the request.
      log: request.log,
      clickhouse: store.client,
      projectionVersion: store.projectionVersion,
    };
  };
}
