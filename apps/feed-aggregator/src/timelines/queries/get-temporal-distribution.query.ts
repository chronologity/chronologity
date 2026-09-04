import type { GraphQLContext } from "../../graphql/context/graphql-context.js";
import {
  distributionFrom,
  type TemporalDistribution,
} from "../services/distribution-composer.js";
import { distributionFor, type GraphQLScale } from "../services/distribution-request.js";
import { scopeOf, type TimelineViewArguments } from "../services/timeline-request.js";

/**
 * The same Timeline, read at a coarser density.
 *
 * Not a different view of history and not a different axis — the vertical
 * Timeline with each row covering a stretch of time instead of an instant.
 * `timeline` is the finest rung of the same ladder, one Moment per row; this is
 * every rung above it.
 *
 * **Two stores, asked at once.** ClickHouse says how much each span holds;
 * PostgreSQL chooses what stands for it. Neither waits for the other, because a
 * span's boundary is a pure function of an instant and a scale rather than
 * anything either store has to be asked for — which is the whole reason both can
 * compute it from one shared generator and meet on the answer.
 *
 * @param view - Whose history, which lens, what narrowing, over what stretch.
 * @param scale - How coarsely to read it.
 * @param wantsRepresentatives - Whether the client asked for the Moments
 *   standing for each span. Read once from the selection set rather than per
 *   span, so a distribution costs one statement per store however many spans it
 *   returns — and none at all against PostgreSQL when nobody asked.
 * @param context - Carries the Viewer, what they may see, and both read models.
 * @returns The spans holding anything, oldest first, and the interval that was
 *   read — which a client needs to draw the empty spans itself.
 * @throws {ValidationError} If the arguments do not describe a view, if it names
 *   no stretch of time, if it reaches before history is held, or if the stretch
 *   and the scale together would be too many spans to answer.
 * @throws {UnauthenticatedError} If the request offered no credential.
 * @throws {OnboardingRequiredError} If onboarding is unfinished.
 */
export async function getTemporalDistribution(
  view: TimelineViewArguments,
  scale: GraphQLScale,
  wantsRepresentatives: boolean,
  context: GraphQLContext,
): Promise<TemporalDistribution> {
  const request = distributionFor(view, scale);
  const viewer = await context.eligibility.forScope(scopeOf(request.view.context));

  const [counts, representatives] = await Promise.all([
    context.timeline.buckets(request.view, viewer, request.scale),
    wantsRepresentatives
      ? context.representatives.choose(
          request.view,
          request.scale,
          viewer.viewerUserId,
          viewer.isAdult,
        )
      : [],
  ]);

  return distributionFrom(request, counts, representatives);
}
