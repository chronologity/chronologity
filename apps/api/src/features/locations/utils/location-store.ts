import { readStream } from "../../../lib/eventstore/read-stream.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import {
  evolveLocation,
  initialLocationState,
  LOCATION_CATEGORY,
  type LocationEvent,
  type LocationState,
} from "../aggregates/location.aggregate.js";
import type { LocationDependencies } from "../dependencies.js";

export interface LoadedLocation {
  readonly state: LocationState;
  readonly revision: bigint | "no_stream";
}

/**
 * Load a Location from its authoritative history.
 *
 * @param deps - Supplies the event store.
 * @param locationId - Which place.
 * @returns Its state and the revision that state reflects, so a decision made
 *   from it can be appended against the same revision.
 */
export async function loadLocation(
  deps: LocationDependencies,
  locationId: string,
): Promise<LoadedLocation> {
  const recorded = await readStream(deps.client, streamName(LOCATION_CATEGORY, locationId));

  let state = initialLocationState;
  for (const event of recorded) {
    state = evolveLocation(state, { type: event.type, payload: event.payload } as LocationEvent);
  }

  const last = recorded[recorded.length - 1];

  return { state, revision: last === undefined ? "no_stream" : last.revision };
}
