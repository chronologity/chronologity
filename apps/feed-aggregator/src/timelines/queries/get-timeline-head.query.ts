import type { GraphQLContext } from "../../graphql/context/graphql-context.js";
import { entryFor, type TimelineEntry } from "../services/timeline-composer.js";
import {
  scopeOf,
  specificationFor,
  type TimelineViewArguments,
} from "../services/timeline-request.js";

/**
 * Where a Timeline opens.
 *
 * A page of one rather than a query of its own: the newest thing a view holds is
 * the first thing it would page to, and two ways of asking could disagree.
 *
 * The newest *occurrence*, never the newest recording — a Moment added today
 * about 1969 belongs in 1969, and letting it become the head would put somebody
 * at the wrong end of their own history the moment they backfilled anything.
 *
 * @param view - The view to open.
 * @param context - Carries the Viewer, what they may see, and the read model.
 * @returns The entry the Timeline opens at, or null when it holds none — for
 *   somebody with no history, and equally for a Timeline closed to this reader.
 * @throws {ValidationError} If the arguments do not describe a view.
 * @throws {UnauthenticatedError} If the request offered no credential.
 * @throws {OnboardingRequiredError} If onboarding is unfinished.
 */
export async function getTimelineHead(
  view: TimelineViewArguments,
  context: GraphQLContext,
): Promise<TimelineEntry | null> {
  const request = specificationFor(view);
  const viewer = await context.eligibility.forScope(scopeOf(request.view.context));
  const slice = await context.timeline.page(
    { ...request.view, limit: 1, direction: "older" },
    viewer,
    undefined,
  );
  const row = slice.rows[0];

  return row === undefined ? null : entryFor(row);
}
