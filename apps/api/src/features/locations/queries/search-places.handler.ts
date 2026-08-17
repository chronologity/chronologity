import type { PlaceSuggestions } from "@chronologity/contracts";
import type { LocationDependencies } from "../dependencies.js";
import type { SearchPlacesQuery } from "./search-places.query.js";

/**
 * Look for places.
 *
 * Nothing here creates anything. What comes back are candidates from the map
 * service; a Location exists only once someone chooses one, at which point it
 * is recorded with an identity of ours.
 *
 * @param deps - The place-search adapter.
 * @param query - What was typed, and how many candidates to return.
 * @returns Candidates and the attribution the data must be shown with. The
 *   attribution is not optional: OpenStreetMap is licensed under ODbL, which
 *   requires crediting contributors wherever the data appears.
 * @throws {Error} If the map service could not be reached.
 */
export async function handleSearchPlaces(
  deps: LocationDependencies,
  query: SearchPlacesQuery,
): Promise<PlaceSuggestions> {
  return deps.places.search(query.query, query.limit);
}
