import { z } from "zod";
import { identifierSchema } from "./identifiers.js";
import { timestampSchema } from "./time.js";

/**
 * Location boundary contracts.
 *
 * A Location is a place, not a coordinate. `40.7505, -73.9934` is a
 * measurement; "Madison Square Garden" is a place. The distinction is the
 * whole point: the same ground can hold different places over time, and a
 * photograph from 1950 must never be labelled with the name of the building
 * standing there now.
 *
 * So a Location records a place as it was understood when someone recorded it,
 * and happens to carry coordinates — rather than being a coordinate that
 * happens to carry a name.
 */

/**
 * How precisely a position is actually known.
 *
 * Recorded rather than inferred. How many decimal places a coordinate happens
 * to have says nothing about how confident anyone is: a phone reports six
 * either way, and someone who only remembers that a photograph was taken in
 * New York must be able to say so rather than invent a street corner
 * (`locations.md:243`).
 */
export const locationPrecisionSchema = z.enum([
  /** A specific spot: a venue, an address, a seat in a theatre. */
  "exact",
  /** Near something, without a definite point: "somewhere in Central Park". */
  "approximate",
  /** A wide area: a city, a region, a country. */
  "broad",
  /** Nothing is known about where. Legitimate history, not missing data. */
  "unknown",
]);

export type LocationPrecision = z.infer<typeof locationPrecisionSchema>;

/**
 * A position on the earth.
 *
 * Optional on a Location, because a place can be meaningful without one and
 * because inventing a coordinate to fill a gap would fabricate historical
 * certainty.
 */
export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export type Coordinates = z.infer<typeof coordinatesSchema>;

/**
 * The wider areas a place sat inside, as recorded.
 *
 * Deliberately flat text rather than references to other Locations. The
 * documents are explicit that administrative boundaries change, places
 * overlap, and a hiking trail crosses several jurisdictions
 * (`locations.md:158-206`) — so this records the context a place was recorded
 * with, and does not claim to describe geography.
 */
export const geographicContextSchema = z.object({
  neighbourhood: z.string().max(200).nullable(),
  city: z.string().max(200).nullable(),
  region: z.string().max(200).nullable(),
  country: z.string().max(200).nullable(),
  /** ISO 3166-1 alpha-2, where known. Useful for grouping; not an identity. */
  countryCode: z.string().length(2).nullable(),
});

export type GeographicContext = z.infer<typeof geographicContextSchema>;

/**
 * A candidate returned by the map service.
 *
 * Not a Location. Nothing here exists in Chronologity until someone chooses
 * it, at which point a Location is created carrying its own identity.
 */
export const placeSuggestionSchema = z.object({
  /**
   * How to refer to this place in the map service, as `type:id` — for example
   * `way:138141251`.
   *
   * Deliberately not the service's own `place_id`, which is an internal row
   * number that changes whenever the data is reimported. This pair is the
   * durable reference.
   */
  reference: z.string().min(1).max(100),
  name: z.string().min(1).max(500),
  /** The full formatted description, for telling similar results apart. */
  description: z.string().min(1).max(1000),
  coordinates: coordinatesSchema,
  context: geographicContextSchema,
});

export type PlaceSuggestion = z.infer<typeof placeSuggestionSchema>;

export const placeSuggestionsSchema = z.object({
  suggestions: z.array(placeSuggestionSchema),
  /**
   * Required attribution for the data.
   *
   * OpenStreetMap is licensed under ODbL, which requires crediting
   * contributors wherever the data is shown.
   */
  attribution: z.string(),
});

export type PlaceSuggestions = z.infer<typeof placeSuggestionsSchema>;

/** A place someone recorded, as anyone permitted to see it receives it. */
export const locationSchema = z.object({
  locationId: identifierSchema,
  /**
   * The name as recorded, and never rewritten by a later lookup.
   *
   * This is what makes historical naming possible: the map service will
   * eventually rename that venue, and this record keeps what it was called
   * when someone recorded it.
   */
  name: z.string().min(1).max(500),
  coordinates: coordinatesSchema.nullable(),
  precision: locationPrecisionSchema,
  context: geographicContextSchema,
  /**
   * Where the information came from in the map service, if it did.
   *
   * A note about provenance, never an identity. A place the service has never
   * heard of is still a place.
   */
  sourceReference: z.string().nullable(),
  createdAt: timestampSchema,
});

export type Location = z.infer<typeof locationSchema>;

/**
 * Creating a place.
 *
 * Either from something the map service returned, or from nothing at all — a
 * grandparent's house is a place no service knows.
 */
export const createLocationRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(500),
    coordinates: coordinatesSchema.optional(),
    precision: locationPrecisionSchema,
    context: geographicContextSchema.partial().optional(),
    /** A suggestion's reference, when this came from a search result. */
    sourceReference: z.string().max(100).optional(),
  })
  .refine(
    (value) => value.precision === "unknown" || value.coordinates !== undefined,
    "A place with a known position needs coordinates",
  )
  .refine(
    (value) => value.precision !== "unknown" || value.coordinates === undefined,
    "A place whose position is unknown cannot carry coordinates",
  );

export type CreateLocationRequest = z.infer<typeof createLocationRequestSchema>;

/** Searching for a place. */
export const searchPlacesRequestSchema = z.object({
  query: z.string().trim().min(2).max(200),
  limit: z.number().int().min(1).max(20).optional(),
});

export type SearchPlacesRequest = z.infer<typeof searchPlacesRequestSchema>;
