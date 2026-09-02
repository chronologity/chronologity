import type {
  GeographicContext,
  Location,
  LocationDisclosure,
  MomentPlace,
} from "@chronologity/contracts";

/**
 * How much of a Moment's place a Viewer receives.
 *
 * Pure, and separate from `checkVisibility` beside it, because the two answer
 * different questions. That one decides whether a Moment may be seen at all;
 * this one decides how much of where it happened comes with it. A Moment can be
 * perfectly readable while its place is withheld — `locations.md:830` states
 * the distinction plainly: "Can view Moment ≠ Can view exact Location".
 *
 * Nothing here is stored. `locations.md:855` asks that Chronologity "avoid
 * storing one pre-rendered Location string as the sole authoritative
 * representation", so the Location is kept whole and what a Viewer receives is
 * derived per request.
 */

/**
 * Reduce a place to what one Viewer may be told.
 *
 * @param viewerUserId - Who is asking.
 * @param authorUserId - Who recorded the Moment.
 * @param disclosure - How much its author chose to tell everybody else.
 * @param location - The place in full, or undefined when the Moment has none.
 * @returns What to put in the response, or null when the Moment has no place at
 *   all. A place that exists but is withheld returns a `hidden` disclosure
 *   rather than null, because "nobody said where" and "you are not being told
 *   where" are different facts and a client should be able to tell them apart.
 */
export function disclosePlace(
  viewerUserId: string,
  authorUserId: string,
  disclosure: LocationDisclosure,
  location: Location | undefined,
): MomentPlace | null {
  if (location === undefined) {
    return null;
  }

  // Their own history. A choice about what to tell other people was never a
  // choice to forget it themselves.
  if (viewerUserId === authorUserId) {
    return { disclosure: "exact", location, area: null };
  }

  switch (disclosure) {
    case "exact":
      return { disclosure: "exact", location, area: null };
    case "neighbourhood":
      return { disclosure: "neighbourhood", location: null, area: location.context };
    case "city":
      return {
        disclosure: "city",
        location: null,
        // The one field that separates this from the tier above. Everything
        // wider than a neighbourhood is already less identifying than the
        // Moment's own author being named.
        area: withoutNeighbourhood(location.context),
      };
    case "hidden":
      return { disclosure: "hidden", location: null, area: null };
    default:
      // Unreachable while the column constraint and the contract agree, and
      // deliberately here anyway. A disclosure nobody recognises must withhold
      // rather than fall through to telling, for the same reason
      // `checkVisibility` denies by default: a widened constraint that forgot
      // this file should show a Viewer less than intended, never more.
      return { disclosure: "hidden", location: null, area: null };
  }
}

/**
 * Drop the narrowest field of a geographic context.
 *
 * @param context - The area a place sits in.
 * @returns The same area with its neighbourhood withheld.
 */
function withoutNeighbourhood(context: GeographicContext): GeographicContext {
  return { ...context, neighbourhood: null };
}
