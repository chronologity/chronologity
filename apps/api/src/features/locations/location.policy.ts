import type { Coordinates, GeographicContext, LocationPrecision } from "@chronologity/contracts";

/**
 * The rules a place has to satisfy.
 *
 * Pure functions, so they need no database and can be exercised exhaustively.
 * A Location is otherwise a plain record, and this is the only part of it that
 * decides anything.
 */

export type LocationRejection = "coordinates_required" | "coordinates_not_permitted";

/**
 * Check that a position and the confidence claimed for it agree.
 *
 * @param precision - How precisely the position is said to be known.
 * @param coordinates - The position, if one was given.
 * @returns The reason to refuse, or undefined when the two agree. A place whose
 *   position is unknown must carry no coordinates, and a place with a known
 *   position must carry them: inventing a coordinate to fill a gap fabricates
 *   exactly the historical certainty this model exists to protect.
 */
export function checkPosition(
  precision: LocationPrecision,
  coordinates: Coordinates | undefined,
): LocationRejection | undefined {
  if (precision === "unknown" && coordinates !== undefined) {
    return "coordinates_not_permitted";
  }

  if (precision !== "unknown" && coordinates === undefined) {
    return "coordinates_required";
  }

  return undefined;
}

/**
 * Say why a place was refused.
 *
 * @param reason - What the check found.
 * @returns A message for the person who asked. Both are safe to state plainly:
 *   neither reveals anything about places somebody else recorded.
 */
export function describeLocationRejection(reason: LocationRejection): string {
  return reason === "coordinates_required"
    ? "A place with a known position needs coordinates"
    : "A place whose position is unknown cannot carry coordinates";
}

/**
 * Fill in the wider areas a place sits inside.
 *
 * @param context - Whatever was supplied, which may name none of them.
 * @returns Every area, with anything unstated recorded as null rather than left
 *   absent. Null says "this was not known when the place was recorded", and a
 *   missing key says nothing at all — a distinction that matters later, when
 *   something has to decide whether to go looking for the answer.
 */
export function fillContext(
  context: { [K in keyof GeographicContext]?: GeographicContext[K] | undefined } | undefined,
): GeographicContext {
  return {
    neighbourhood: context?.neighbourhood ?? null,
    city: context?.city ?? null,
    region: context?.region ?? null,
    country: context?.country ?? null,
    countryCode: context?.countryCode ?? null,
  };
}
