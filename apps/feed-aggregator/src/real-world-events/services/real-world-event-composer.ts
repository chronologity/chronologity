import type { RealWorldEventRow } from "../../read-models/postgres/real-world-event-read-model.js";

/**
 * An occasion as a client receives it.
 *
 * What is absent is decided rather than forgotten. There is no
 * `createdByUserId`: recording an occurrence is provenance and never ownership,
 * and a field of that name on a client is one somebody eventually builds a
 * permission around. There is no `createdAt` either — when the record was made
 * is not when the occurrence happened, and this schema keeps saying so.
 */

/** A place, as the schema describes one. */
export interface EventPlaceShape {
  readonly locationId: string;
  readonly name: string;
  readonly coordinates: { latitude: number; longitude: number } | null;
  readonly precision: string;
  readonly context: {
    neighbourhood: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
    countryCode: string | null;
  };
}

/** An occasion, composed. */
export interface RealWorldEventShape {
  readonly realWorldEventId: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly occurrence: { start: Date; end: Date; precision: string };
  readonly locations: readonly EventPlaceShape[];
}

/**
 * Shape a stored occasion.
 *
 * @param row - The occasion, with its aliases and places gathered.
 * @returns What a reader receives. Aliases and places arrive as null when there
 *   are none, and become empty lists — "this occurrence goes by no other name"
 *   is a fact, where a missing key would only mean "not loaded".
 */
export function realWorldEventFor(row: RealWorldEventRow): RealWorldEventShape {
  return {
    realWorldEventId: row.real_world_event_id,
    name: row.name,
    aliases: row.aliases ?? [],
    occurrence: {
      start: row.occurrence_start,
      end: row.occurrence_end,
      precision: row.occurrence_precision.toUpperCase(),
    },
    locations: (row.locations ?? []).map((place) => ({
      locationId: place.locationId,
      name: place.name,
      coordinates:
        place.latitude === null || place.longitude === null
          ? null
          : { latitude: Number(place.latitude), longitude: Number(place.longitude) },
      precision: place.precision.toUpperCase(),
      context: {
        neighbourhood: place.neighbourhood,
        city: place.city,
        region: place.region,
        country: place.country,
        countryCode: place.countryCode,
      },
    })),
  };
}
