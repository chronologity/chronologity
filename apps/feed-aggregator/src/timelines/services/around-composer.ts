import type { ViewSpecification } from "@chronologity/contracts";
import type { TimelineScopeRef } from "@chronologity/timeline-derivation";
import type { TimelineSlice } from "../../read-models/clickhouse/timeline-read-model.js";
import type { GraphQLJumpReason, ResolvedAnchor } from "./jump-anchor.js";
import {
  asEnum,
  connectionFor,
  type TimelineConnection,
  type TimelineEntry,
} from "./timeline-composer.js";

/**
 * Assembling a landing out of two pages.
 *
 * A jump is not a page and not a search. It is a *position*, and the history
 * either side of it — which is what lets somebody carry on reading normally the
 * moment they arrive, rather than being stranded on one Moment with no way
 * forward.
 *
 * **The position is preserved rather than redefined.** `timeline.md:367` is
 * explicit: an instant nobody recorded anything at stays that instant, and is
 * not quietly reported as whichever Moment happened to be nearest. So `at` is
 * what was found *at* the position, and null the rest of the time, with the
 * surrounding pages showing what lies either side.
 */

/** Where a jump landed, and the history either side of it. */
export interface TimelineAround {
  /**
   * The position landed at.
   *
   * Null only when the destination was not this reader's to reach, which is
   * deliberately the same answer as one that never existed.
   */
  readonly anchoredAt: Date | null;
  /** What was at the position, or null when nothing was. */
  readonly at: TimelineEntry | null;
  readonly scope: { readonly type: string; readonly id: string };
  readonly reason: GraphQLJumpReason;
  readonly older: TimelineConnection;
  readonly newer: TimelineConnection;
}

/**
 * The answer when a jump has nowhere to go.
 *
 * One value for three different reasons — the destination never existed, it is
 * not this reader's to see, or it sits on a Timeline they may not open. Telling
 * them apart would say something was there, which `privacy.md:544` refuses.
 *
 * @param scope - What was asked about, which is safe to echo: the client sent it.
 * @param reason - How the destination was named, likewise.
 * @returns A landing with no position and no history.
 */
export function nowhere(scope: TimelineScopeRef, reason: GraphQLJumpReason): TimelineAround {
  const empty: TimelineConnection = {
    edges: [],
    pageInfo: {
      startCursor: null,
      endCursor: null,
      hasNextPage: false,
      hasPreviousPage: false,
    },
    scope: { type: asEnum(scope.type), id: scope.id },
  };

  return {
    anchoredAt: null,
    at: null,
    scope: empty.scope,
    reason,
    older: empty,
    newer: empty,
  };
}

/**
 * Put a landing together.
 *
 * **The two pages answer each other's near side.** `connectionFor` decides
 * `hasPreviousPage` from whether a cursor was supplied, because for an ordinary
 * page that is exactly what says there is something to go back to. Neither half
 * of a jump was reached by a cursor, yet each has history on its near side — the
 * other half. So each is told about the other. Passing false would say there is
 * nothing between the landing and the present, which a client can be written
 * against.
 *
 * @param anchor - Where the jump went, already resolved and reauthorized.
 * @param view - The view the two pages were read under, for its scope.
 * @param older - History at the position and before it, newest first.
 * @param newer - History after it.
 * @returns The landing.
 */
export function aroundFrom(
  anchor: ResolvedAnchor,
  view: ViewSpecification,
  older: TimelineSlice,
  newer: TimelineSlice,
): TimelineAround {
  const olderSide = connectionFor(older, { ...view, direction: "older" }, newer.rows.length > 0);
  const newerSide = connectionFor(newer, { ...view, direction: "newer" }, older.rows.length > 0);

  return {
    anchoredAt: anchor.instant,
    at: landing(anchor, olderSide),
    // One value, handed to the jump and read back from the pages it composed, so
    // a client is never asked to pick between three answers and trust they agree.
    scope: olderSide.scope,
    reason: anchor.reason,
    older: olderSide,
    newer: newerSide,
  };
}

/**
 * What sits exactly at the position, if anything does.
 *
 * The older page is the inclusive side, so its first entry is the landing when
 * there is one. It stays in that page rather than being lifted out of it:
 * removing it would shorten a page by one depending on whether the destination
 * happened to be a member, which is a page coming back short for a reason its
 * size cannot explain.
 *
 * @param anchor - Where the jump went.
 * @param older - History at the position and before it.
 * @returns The entry at the position, or null. Null is the ordinary answer for
 *   an instant nobody recorded anything at.
 */
function landing(anchor: ResolvedAnchor, older: TimelineConnection): TimelineEntry | null {
  const first = older.edges[0]?.node;

  if (first === undefined) {
    return null;
  }

  // A named Moment is the landing only if this is actually it. A jump to a
  // Moment the Timeline being read does not hold lands at the right instant with
  // nothing at it, which the composer answers by reading the destination's own
  // Timeline instead.
  if (anchor.momentId !== undefined) {
    return first.momentId === anchor.momentId ? first : null;
  }

  return first.occurredAt.getTime() === anchor.instant.getTime() ? first : null;
}
