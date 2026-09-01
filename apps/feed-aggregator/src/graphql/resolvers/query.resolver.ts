import type { GraphQLContext } from "../context/graphql-context.js";

/** The shape `Query.viewer` returns, matching the SDL. */
export interface ViewerResult {
  readonly authenticated: boolean;
  /** Null rather than absent, because GraphQL has no undefined. */
  readonly userId: string | null;
}

/**
 * The root read resolvers.
 *
 * Thin by rule (`feed.md:243`): validate, take the Viewer from the context, call
 * a query function, map the result. No SQL, no eligibility algorithm, and no
 * cache key construction belongs here — a resolver that grew any of those would
 * be a place where a Timeline decision could be made without anything owning it.
 *
 * There is one resolver so far, and it does not read a store at all. Timeline
 * composition arrives with the phase that has read models to compose.
 */
export const queryResolvers = {
  Query: {
    /**
     * Report who this service thinks is asking.
     *
     * @param _parent - Unused; this is a root field.
     * @param _arguments - Unused; the field takes none.
     * @param context - Carries the Viewer resolved for this request.
     * @returns Whether the request carried credentials that held up, and the
     *   account reading if there is one. A request that offered credentials
     *   which did not hold up never reaches here — it was refused — so `false`
     *   means no credentials were offered rather than that some were rejected.
     */
    viewer(_parent: unknown, _arguments: unknown, context: GraphQLContext): ViewerResult {
      if (context.viewer.kind === "anonymous") {
        return { authenticated: false, userId: null };
      }

      return {
        authenticated: true,
        // Null for somebody who has signed in but not finished creating an
        // account. An ordinary state, and one a client has to be able to see,
        // since it is the difference between "sign in" and "finish signing up".
        userId: context.viewer.userId ?? null,
      };
    },
  },
};
