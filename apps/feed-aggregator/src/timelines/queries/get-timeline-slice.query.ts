import type { GraphQLContext } from "../../graphql/context/graphql-context.js";
import { connectionFor, type TimelineConnection } from "../services/timeline-composer.js";
import {
  scopeOf,
  specificationFor,
  type PagingArguments,
  type TimelineViewArguments,
} from "../services/timeline-request.js";

/**
 * A page of history, composed.
 *
 * Its own module rather than a resolver body, because `feed.md:249` asks a
 * resolver to validate, resolve the Viewer, **call a composition function**, and
 * map — and a resolver that inlined this would be doing the third step itself.
 * What is here is the composition: four steps in an order that matters, and
 * nothing about GraphQL.
 *
 * The arguments become a specification **before** eligibility is resolved. That
 * order is deliberate: a refusal at this stage describes only what the client
 * sent, where resolving first would send a scope identifier the contract has not
 * checked to PostgreSQL.
 *
 * @param view - Whose history, which lens, what narrowing.
 * @param paging - Where the reader is and how much they want.
 * @param context - Carries the Viewer, what they may see, and the read model.
 * @returns The page, newest first, with a cursor at each end. Empty for a
 *   Timeline its owner has closed, which is indistinguishable from one holding
 *   nothing — refusing would say there was something there to refuse.
 * @throws {ValidationError} If the arguments do not describe a view.
 * @throws {UnauthenticatedError} If the request offered no credential: reading
 *   history requires an account.
 * @throws {OnboardingRequiredError} If somebody is signed in but has not
 *   finished creating an account.
 */
export async function getTimelineSlice(
  view: TimelineViewArguments,
  paging: PagingArguments,
  context: GraphQLContext,
): Promise<TimelineConnection> {
  const request = specificationFor(view, paging);
  const viewer = await context.eligibility.forScope(scopeOf(request.view.context));
  const slice = await context.timeline.page(request.view, viewer, request.from);

  return connectionFor(slice, request.view, request.from !== undefined);
}
