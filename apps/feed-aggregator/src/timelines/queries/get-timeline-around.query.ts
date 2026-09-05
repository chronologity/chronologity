import type { ViewSpecification } from "@chronologity/contracts";
import type { TimelineScopeRef } from "@chronologity/timeline-derivation";
import type { GraphQLContext } from "../../graphql/context/graphql-context.js";
import type { TimelineSlice } from "../../read-models/clickhouse/timeline-read-model.js";
import { aroundFrom, nowhere, type TimelineAround } from "../services/around-composer.js";
import {
  resolveAnchor,
  viewFor,
  type ResolvedAnchor,
  type TimelineAnchorArguments,
} from "../services/jump-anchor.js";
import { specificationFor, type TimelineViewArguments } from "../services/timeline-request.js";

/**
 * Arriving somewhere without travelling there.
 *
 * A Timeline that spans decades cannot be read only by scrolling, so somebody
 * must be able to name a destination and be taken to it. What comes back is a
 * *position* and the history either side of it, so ordinary navigation carries
 * on from the moment they land.
 *
 * **Nothing here trusts the way the destination was named.** A relationship
 * pointing at a Moment, an occasion, a place, a span — each is a pointer, and a
 * pointer has never been a permission. Every one is reauthorized before its
 * instant is used, and a destination that is not this reader's to reach answers
 * exactly as one that never existed.
 */

/**
 * Read a landing.
 *
 * @param view - Whose history was being read when the jump was made.
 * @param anchor - How the destination was named. Exactly one way.
 * @param first - How much history to return either side.
 * @param context - Carries the Viewer, what they may see, and the read models.
 * @returns The position, what was at it, the Timeline landed in, and the pages
 *   either side. A destination that cannot be reached comes back as a position
 *   of nothing rather than as a refusal, because refusing would say something
 *   was there.
 * @throws {ValidationError} If the arguments do not describe a view, if no
 *   destination was named or several were, if an instant falls before history is
 *   held, or if a span was named that does not begin where its scale says.
 * @throws {UnauthenticatedError} If the request offered no credential.
 * @throws {OnboardingRequiredError} If onboarding is unfinished.
 */
export async function getTimelineAround(
  view: TimelineViewArguments,
  anchor: TimelineAnchorArguments,
  first: number | undefined,
  context: GraphQLContext,
): Promise<TimelineAround> {
  const request = specificationFor(view, first === undefined ? {} : { first });
  // The Viewer's own facts, not a Timeline's. A destination may live in a
  // Timeline other than the one in hand, so resolving eligibility for the
  // Timeline being read would answer the wrong question here.
  const facts = await context.eligibility.forViewer();
  const resolved = await resolveAnchor(anchor, request.view, facts, context);

  if (resolved === undefined) {
    return nowhere(request.view.context, reasonFor(anchor));
  }

  const landed = await land(resolved, request.view, context);

  // A Moment that is real and readable but simply not part of the Timeline being
  // read. Rather than leaving somebody at the right instant in a history that
  // does not contain what they asked for, read the one Timeline guaranteed to
  // hold it — its author's — and say that is where they are.
  const author = resolved.authorUserId;
  const alreadyTheirs =
    request.view.context.type === "person" && request.view.context.id === author;

  return resolved.momentId !== undefined && author !== undefined && landed.at === null && !alreadyTheirs
    ? elsewhere(resolved, request.view, context)
    : landed;
}

/**
 * Read the two pages either side of a position.
 *
 * **One eligibility for both halves.** Two resolutions could disagree — a Block
 * taking effect between them, a suspension landing — and a jump whose halves
 * disagreed about what may be seen would be worse than one that was merely slow.
 *
 * @param anchor - Where to land.
 * @param view - What was being read.
 * @param context - Carries the read model and the memoised eligibility.
 * @returns The landing.
 */
async function land(
  anchor: ResolvedAnchor,
  view: ViewSpecification,
  context: GraphQLContext,
): Promise<TimelineAround> {
  const destination = viewFor(view, anchor.scope);
  const viewer = await context.eligibility.forScope(anchor.scope);
  const boundary =
    anchor.momentId === undefined
      ? ({ kind: "instant", at: anchor.instant } as const)
      : ({
          kind: "position",
          position: { occurredAt: anchor.instant, momentId: anchor.momentId },
          // The landing belongs to the page before it rather than after it, so
          // the older page's first row is what was arrived at.
          inclusive: true,
        } as const);

  const [older, newer]: [TimelineSlice, TimelineSlice] = await Promise.all([
    context.timeline.page({ ...destination, direction: "older" }, viewer, boundary),
    context.timeline.page(
      { ...destination, direction: "newer" },
      viewer,
      anchor.momentId === undefined
        ? boundary
        : { kind: "position", position: { occurredAt: anchor.instant, momentId: anchor.momentId }, inclusive: false },
    ),
  ]);

  return aroundFrom(anchor, destination, older, newer);
}

/**
 * Land in the destination's own Timeline instead.
 *
 * The second and only other scope a request resolves. It is a different memo
 * key, so a different audience list bounded to that scope and a different answer
 * about whether the Timeline is open at all — which is exactly why reusing the
 * first resolution would be wrong rather than merely stale.
 *
 * @param anchor - Where the jump went.
 * @param view - What was being read.
 * @param context - Carries the read model and the memoised eligibility.
 * @returns The landing, in the author's Timeline.
 */
async function elsewhere(
  anchor: ResolvedAnchor,
  view: ViewSpecification,
  context: GraphQLContext,
): Promise<TimelineAround> {
  const scope: TimelineScopeRef = { type: "person", id: anchor.authorUserId as string };

  return land({ ...anchor, scope }, view, context);
}

/**
 * Which reason to report when nothing could be resolved.
 *
 * Echoed from what the client sent, which discloses nothing it does not already
 * know, and keeps an unreachable destination the same shape as a reachable one.
 *
 * @param anchor - What was asked for.
 * @returns The reason.
 */
function reasonFor(anchor: TimelineAnchorArguments): ResolvedAnchor["reason"] {
  if (anchor.moment !== undefined && anchor.moment !== null) {
    return "MOMENT";
  }

  if (anchor.location !== undefined && anchor.location !== null) {
    return "LOCATION";
  }

  if (anchor.realWorldEvent !== undefined && anchor.realWorldEvent !== null) {
    return "REAL_WORLD_EVENT";
  }

  if (anchor.causal !== undefined && anchor.causal !== null) {
    return "CAUSAL_RELATIONSHIP";
  }

  if (anchor.significance !== undefined && anchor.significance !== null) {
    return "HISTORICAL_SIGNIFICANCE";
  }

  // Reported for a refused reference too, which is what keeps a thing no longer
  // findable indistinguishable from one that was never there. The reason travels
  // with the request rather than with the outcome, so it says nothing about
  // which of the refusals happened.
  if (anchor.searchResult !== undefined && anchor.searchResult !== null) {
    return "SEARCH_RESULT";
  }

  return "INSTANT";
}
