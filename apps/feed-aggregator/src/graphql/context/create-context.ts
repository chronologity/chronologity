import type { FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { ANONYMOUS } from "../../auth/auth-context.js";
import type { TimelineEligibilityResolver } from "@chronologity/timeline-derivation";
import { RequestEligibility } from "../../auth/request-eligibility.js";
import { createLoaders } from "../../loaders/create-loaders.js";
import type { ReadStore } from "../../read-models/clickhouse/client.js";
import { TimelineReadModel } from "../../read-models/clickhouse/timeline-read-model.js";
import { ContextAxisReadModel } from "../../read-models/clickhouse/context-axis-read-model.js";
import { ContextNameReadModel } from "../../read-models/postgres/context-name-read-model.js";
import { MomentReadModel } from "../../read-models/postgres/moment-read-model.js";
import { RealWorldEventReadModel } from "../../read-models/postgres/real-world-event-read-model.js";
import { RepresentativeReadModel } from "../../read-models/postgres/representative-read-model.js";
import { SearchDocumentReadModel } from "../../read-models/postgres/search-document-read-model.js";
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
 * @param directory - The read-only PostgreSQL pool, for the reads that cannot
 *   come from the Timeline projection: a Moment's own detail, which the
 *   projection deliberately does not hold.
 * @param searchIndexVersion - Which Search index to ask whether a found thing
 *   is still findable. Named by configuration because `apps/api` owns the
 *   constant, and this application must not carry a second copy of it.
 * @returns A function Mercurius calls once per request, producing the context
 *   every resolver receives.
 */
export function createContext(
  store: ReadStore,
  eligibility: TimelineEligibilityResolver,
  directory: Pool,
  searchIndexVersion: string,
) {
  const timeline = new TimelineReadModel(store.client, store.projectionVersion);
  const moments = new MomentReadModel(directory);
  const contextAxis = new ContextAxisReadModel(store.client, store.projectionVersion);
  const contextNames = new ContextNameReadModel(directory);
  const realWorldEvents = new RealWorldEventReadModel(directory);
  const representatives = new RepresentativeReadModel(directory);
  const searchDocuments = new SearchDocumentReadModel(directory, searchIndexVersion);

  return function contextFor(request: FastifyRequest): GraphQLContext {
    const viewer = request.viewer ?? ANONYMOUS;
    // Built per request and never shared. Nothing is resolved yet: a query
    // that reads no history — `viewer`, say — should pay for none of it.
    const requestEligibility = new RequestEligibility(eligibility, viewer);

    return {
      viewer,
      eligibility: requestEligibility,
      // Here rather than in the outer body, and that is the control rather than
      // a preference: the Viewer exists only inside this closure, so a loader
      // holding one cannot be hoisted to process scope — it would not compile.
      loaders: createLoaders(moments, requestEligibility, request.log),
      traceId: request.traceId,
      // Already bound to this request, so a resolver logging a slow query
      // produces a line that can be found beside the rest of the request.
      log: request.log,
      // One read model for the process rather than one per request: it holds a
      // client and a projection version and nothing about who is asking, so
      // sharing it cannot leak a Viewer between requests.
      timeline,
      moments,
      contextAxis,
      contextNames,
      realWorldEvents,
      representatives,
      searchDocuments,
    };
  };
}
