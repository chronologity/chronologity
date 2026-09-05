import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { TimelineEligibilityResolver } from "@chronologity/timeline-derivation";
import mercurius from "mercurius";
import type { SessionLookup } from "../auth/session.repository.js";
import type { AuthConfig } from "../config/auth-config.js";
import type { GraphQLConfig } from "../config/graphql-config.js";
import { createContext } from "../graphql/context/create-context.js";
import { formatErrors } from "../graphql/format-errors.js";
import { loadSchema } from "../graphql/load-schema.js";
import {
  mediaTypeResolver,
  momentFields,
  momentQueries,
} from "../graphql/resolvers/moment.resolver.js";
import { contextQueries } from "../graphql/resolvers/context.resolver.js";
import { queryResolvers } from "../graphql/resolvers/query.resolver.js";
import { timelineEntryResolver, timelineQueries } from "../graphql/resolvers/timeline.resolver.js";
import { cursorScalar } from "../graphql/scalars/cursor.scalar.js";
import { dateTimeScalar } from "../graphql/scalars/date-time.scalar.js";
import { authPlugin } from "../plugins/auth.plugin.js";
import type { ReadStore } from "../read-models/clickhouse/client.js";
import { costLimit } from "../graphql/cost/cost-rule.js";
import { rateLimitPlugin, type RateLimits } from "../plugins/rate-limit.plugin.js";
import { recordRefusal } from "../observability/metrics.js";
import { instrument, type Instrumentable } from "../plugins/metrics.plugin.js";

export interface GraphQLWiring {
  readonly config: GraphQLConfig;
  readonly auth: AuthConfig;
  readonly sessions: SessionLookup;
  readonly store: ReadStore;
  /** Reads current state to decide what a Viewer may see. Wrapped per request. */
  readonly eligibility: TimelineEligibilityResolver;
  /** The read-only pool a Moment's own detail is read through. */
  readonly directory: Pool;
  /** Which Search index answers whether a found thing is still findable. */
  readonly searchIndexVersion: string;
  /** How often one reader may ask. Injected so a suite can raise it. */
  readonly rateLimits: RateLimits;
}

/**
 * Mount the read contract.
 *
 * Registered inside its own scope, and that is load-bearing rather than tidy.
 * Mercurius calls `setErrorHandler` when it loads, and it is a `fastify-plugin`
 * — so registering it at the root would replace this application's error
 * handler for every route, and `/health/ready` would start answering in the
 * GraphQL error format. Encapsulating it means GraphQL failures are shaped like
 * GraphQL and everything else keeps the envelope the API also uses.
 *
 * The authentication hook goes in the same scope for the matching reason:
 * health checks have no Viewer, and running token verification on a readiness
 * probe would let a stale credential make an instance look unready.
 *
 * @param app - The application to mount on.
 * @param wiring - The depth bound and explorer setting, how to verify a token,
 *   where to ask whether a Session is open, the store resolvers read through,
 *   and how to decide what the Viewer may see of it.
 * @returns Nothing.
 */
export async function registerGraphql(app: FastifyInstance, wiring: GraphQLWiring): Promise<void> {
  await app.register(async (scope) => {
    await scope.register(authPlugin, { config: wiring.auth, sessions: wiring.sessions });

    // After authentication, so there is a Viewer to key on, and inside this
    // scope so a readiness probe is never rate limited — an instance that
    // looked unready because somebody was scrolling too fast would be taken
    // out of rotation for the opposite of the reason limits exist.
    await scope.register(rateLimitPlugin, wiring.rateLimits);

    await scope.register(mercurius, {
      schema: loadSchema(),
      resolvers: {
        // Merged field by field rather than by spreading two objects that both
        // carry a `Query`, which would keep only the last one.
        Query: { ...queryResolvers.Query, ...timelineQueries, ...momentQueries, ...contextQueries },
        Moment: momentFields,
        TimelineEntry: timelineEntryResolver,
        Media: mediaTypeResolver,
        // Attached by name, and the names must match the SDL: Mercurius builds
        // the schema first and then copies these onto the types it found, so a
        // scalar declared here and not there fails at startup rather than
        // silently doing nothing.
        Cursor: cursorScalar,
        DateTime: dateTimeScalar,
      },
      context: createContext(
        wiring.store,
        wiring.eligibility,
        wiring.directory,
        wiring.searchIndexVersion,
      ),
      // No mutations, and `defineMutation` stays off so the schema does not
      // grow an empty one. A read service that advertised a mutation type
      // would be inviting the first person in a hurry to add one.
      defineMutation: false,
      // No subscriptions either. Chronology does not push.
      subscription: false,
      // The one cost control this phase carries. Field weighting and a total
      // complexity budget belong with the queries they weigh, and those arrive
      // with Timeline composition.
      queryDepth: wiring.config.maxDepth,
      // Beside depth rather than instead of it. Depth refuses a document that
      // reaches too far down; this refuses one that asks for too much across.
      // Both run before execution, which is the only place a refusal is free.
      validationRules: [costLimit(wiring.config.maxCost, () => recordRefusal("cost"))],
      graphiql: wiring.config.graphiql,
      errorFormatter: formatErrors,
    });

    // After registration, because the hooks attach to the instance Mercurius
    // decorates the scope with. Inside the scope, so they see this application's
    // GraphQL requests and nothing else.
    instrument(scope.graphql as unknown as Instrumentable);
  });
}
