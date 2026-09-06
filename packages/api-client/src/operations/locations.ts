import {
  createLocationRequestSchema,
  locationSchema,
  placeSuggestionsSchema,
  searchPlacesRequestSchema,
} from "@chronologity/contracts";
import { defineOperation } from "./operation.js";

/**
 * Places, as shared reference data.
 *
 * A place belongs to nobody. Creating one is closer to naming something than to
 * recording something, and a place keeps the name it had when a Moment was
 * recorded — so a client should not expect these to change under it, nor treat
 * a rename elsewhere as invalidating what a Moment says.
 */

/** Look for a place by name, through whatever the API is configured to ask. */
export const searchPlaces = defineOperation({
  method: "GET",
  template: "/places/search",
  query: searchPlacesRequestSchema,
  response: placeSuggestionsSchema,
});

/** Record a place, so Moments can point at it. */
export const createLocation = defineOperation({
  method: "POST",
  template: "/locations",
  body: createLocationRequestSchema,
  response: locationSchema,
});

/** One place. */
export const getLocation = defineOperation({
  method: "GET",
  template: "/locations/:locationId",
  path: (args: { params: { locationId: string } }) => `/locations/${args.params.locationId}`,
  response: locationSchema,
});
