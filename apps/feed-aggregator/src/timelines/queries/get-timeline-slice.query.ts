import type { GraphQLContext } from "../../graphql/context/graphql-context.js";
import { withSpan } from "../../observability/tracing.js";
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
  return withSpan("resolve timeline", () => page(view, paging, context));
}

/**
 * The four steps, inside a span that names each of them.
 *
 * Split from the entry point only so the span wraps the whole composition rather
 * than part of it. The stages beneath — eligibility, the ClickHouse read, the
 * enrichment the loaders do — open their own spans where they happen, so a trace
 * shows which of them a slow page spent its time in (`feed.md:1303-1308`).
 *
 * @param view - Whose history, which lens, what narrowing.
 * @param paging - Where the reader is and how much they want.
 * @param context - Carries the Viewer, what they may see, and the read model.
 * @returns The page.
 * @throws {ValidationError} If the arguments do not describe a view.
 * @throws {UnauthenticatedError} If the request offered no credential.
 * @throws {OnboardingRequiredError} If the account is unfinished.
 */
async function page(
  view: TimelineViewArguments,
  paging: PagingArguments,
  context: GraphQLContext,
): Promise<TimelineConnection> {
  // Named as a stage though it touches no store: a cursor this service did not
  // issue is refused here, and a trace that stopped at "the request failed"
  // would not say that reading the client's own position is where it failed.
  const request = await withSpan("decode cursor", async () => specificationFor(view, paging));
  const viewer = await context.eligibility.forScope(scopeOf(request.view.context));
  const slice = await context.timeline.page(
    request.view,
    viewer,
    // A cursor resumes *past* the row it names, which is what stops the next
    // page repeating the last one's final entry.
    request.from === undefined
      ? undefined
      : {
          kind: "position",
          position: { occurredAt: request.from.occurredAt, momentId: request.from.momentId },
          inclusive: false,
        },
  );

  return withSpan("map GraphQL response", async () =>
    connectionFor(slice, request.view, request.from !== undefined),
  );
}
