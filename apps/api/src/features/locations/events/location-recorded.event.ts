import type { Coordinates, GeographicContext, LocationPrecision } from "@chronologity/contracts";
import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * A place was recorded.
 *
 * Everything here is captured as it was understood at this moment, and nothing
 * later rewrites it. That is the whole point: the map service will rename that
 * venue eventually, and a photograph from 1950 must not be relabelled with the
 * name of the building standing there now.
 *
 * The source reference notes where the information came from, and is never
 * identity. A place the map service has never heard of is still a place.
 */
export type LocationRecorded = DomainEvent<
  "LocationRecorded",
  {
    locationId: string;
    /** Who recorded it. */
    recordedByUserId: string;
    name: string;
    coordinates: Coordinates | undefined;
    /** How precisely the position is known. Recorded, never inferred. */
    precision: LocationPrecision;
    context: GeographicContext;
    /** Where in the map service this came from, if it did. */
    sourceReference: string | undefined;
    recordedAt: string;
  }
>;
