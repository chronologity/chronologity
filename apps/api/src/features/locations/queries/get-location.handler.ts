import type { Location } from "@chronologity/contracts";
import { NotFoundError } from "../../../lib/errors/not-found-error.js";
import type { LocationDependencies } from "../dependencies.js";
import { readLocation } from "../utils/location-read-model.js";
import type { GetLocationQuery } from "./get-location.query.js";

/**
 * Read one place.
 *
 * Anyone authenticated may read a place. A Location carries no privacy of its
 * own yet — what limits who sees how precisely is 5F-3, and it attaches to the
 * Moment a place is used by rather than to the place itself.
 *
 * @param deps - Database.
 * @param query - Which place.
 * @returns The place.
 * @throws {NotFoundError} If there is no such place.
 */
export async function handleGetLocation(
  deps: LocationDependencies,
  query: GetLocationQuery,
): Promise<Location> {
  const location = await readLocation(deps.pool, query.locationId);

  if (location === undefined) {
    throw new NotFoundError("No such location");
  }

  return location;
}
