import type { Coordinates, GeographicContext, LocationPrecision } from "@chronologity/contracts";
import type { LocationRecorded } from "../events/location-recorded.event.js";

/**
 * Location — a place, as someone recorded it.
 *
 * Not a coordinate. `40.7505, -73.9934` is a measurement; "Madison Square
 * Garden" is a place, and the same ground can hold different places over time
 * (`locations.md:117`). So this records what a place was understood to be when
 * it was recorded, and happens to carry coordinates.
 *
 * Identity is ours. When someone picks a search result, Chronologity creates
 * its own record with its own identifier and copies what it needs; the map
 * service's reference is kept as provenance and never as identity
 * (`locations.md:90`). Without that, a rename by the map service would rewrite
 * history.
 *
 * Nothing here changes after recording. Corrections, merges, and names that
 * change over time are real and deferred: `locations.md` still lists them
 * among its open questions, and guessing now means unpicking later.
 */

export const LOCATION_CATEGORY = "location";

export interface LocationState {
  readonly exists: boolean;
  readonly locationId: string | undefined;
  readonly name: string | undefined;
  readonly coordinates: Coordinates | undefined;
  readonly precision: LocationPrecision | undefined;
  readonly context: GeographicContext | undefined;
  readonly sourceReference: string | undefined;
}

export type LocationEvent = LocationRecorded;

export const initialLocationState: LocationState = {
  exists: false,
  locationId: undefined,
  name: undefined,
  coordinates: undefined,
  precision: undefined,
  context: undefined,
  sourceReference: undefined,
};

/**
 * Rebuild a Location from its history.
 *
 * Pure, so replay is deterministic.
 *
 * @param state - State so far.
 * @param event - The next event.
 * @returns The state after applying it; unrecognised types leave it unchanged.
 */
export function evolveLocation(state: LocationState, event: LocationEvent): LocationState {
  switch (event.type) {
    case "LocationRecorded":
      return {
        ...state,
        exists: true,
        locationId: event.payload.locationId,
        name: event.payload.name,
        coordinates: event.payload.coordinates,
        precision: event.payload.precision,
        context: event.payload.context,
        sourceReference: event.payload.sourceReference,
      };

    default:
      return state;
  }
}

export type LocationRejection =
  "location_already_exists" | "coordinates_required" | "coordinates_not_permitted";

export type LocationDecision =
  | { readonly ok: true; readonly events: readonly LocationEvent[] }
  | { readonly ok: false; readonly reason: LocationRejection };

/**
 * Record a place.
 *
 * @param state - Must be the initial state.
 * @param input - The new identifier, who is recording it, the name, optional
 *   coordinates, how precisely the position is known, the wider areas it sits
 *   inside, an optional map-service reference, and the current instant.
 * @returns The event to append, or a refusal. A position that is known needs
 *   coordinates, and a position that is unknown must not carry them —
 *   inventing a coordinate to fill a gap would fabricate historical certainty,
 *   which is the failure this whole model exists to prevent.
 */
export function decideRecordLocation(
  state: LocationState,
  input: {
    locationId: string;
    recordedByUserId: string;
    name: string;
    coordinates: Coordinates | undefined;
    precision: LocationPrecision;
    context: GeographicContext;
    sourceReference: string | undefined;
    now: Date;
  },
): LocationDecision {
  if (state.exists) {
    return { ok: false, reason: "location_already_exists" };
  }

  if (input.precision === "unknown" && input.coordinates !== undefined) {
    return { ok: false, reason: "coordinates_not_permitted" };
  }

  if (input.precision !== "unknown" && input.coordinates === undefined) {
    return { ok: false, reason: "coordinates_required" };
  }

  return {
    ok: true,
    events: [
      {
        type: "LocationRecorded",
        payload: {
          locationId: input.locationId,
          recordedByUserId: input.recordedByUserId,
          name: input.name,
          coordinates: input.coordinates,
          precision: input.precision,
          context: input.context,
          sourceReference: input.sourceReference,
          recordedAt: input.now.toISOString(),
        },
      },
    ],
  };
}
