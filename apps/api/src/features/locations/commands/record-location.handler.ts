import { randomUUID } from "node:crypto";
import type { GeographicContext, Location } from "@chronologity/contracts";
import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import { ValidationError } from "../../../lib/errors/validation-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import {
  decideRecordLocation,
  initialLocationState,
  LOCATION_CATEGORY,
} from "../aggregates/location.aggregate.js";
import { clockFor, type LocationDependencies } from "../dependencies.js";
import { locationEventMetadata } from "../utils/event-metadata.js";
import {
  findLocationBySource,
  readLocation,
  recordLocation,
} from "../utils/location-read-model.js";
import type { RecordLocationCommand } from "./record-location.command.js";

/**
 * Record a place.
 *
 * The name and surrounding context are copied in and never rewritten by a
 * later lookup. That is what makes historical naming work: the map service
 * will rename that venue eventually, and this record keeps what it was called
 * when someone recorded it.
 *
 * @param deps - Event store, database, and clock.
 * @param command - The name, position, precision, context, and optional
 *   map-service reference.
 * @param context - Trace identifier and receipt time.
 * @returns The place. When the same map-service reference has been recorded
 *   before, the existing place is returned rather than a second one created —
 *   two people choosing the same search result mean the same place.
 * @throws {ValidationError} If a known position carries no coordinates, or an
 *   unknown one carries them.
 */
export async function handleRecordLocation(
  deps: LocationDependencies,
  command: RecordLocationCommand,
  context: RequestContext,
): Promise<Location> {
  const at = clockFor(deps)();
  const { recordedByUserId, name, coordinates, precision, sourceReference } = command.payload;

  // Chosen the same search result as someone else. Returning what exists keeps
  // one place for one place; the unique index behind this is what makes it
  // true under concurrency rather than merely usually.
  if (sourceReference !== undefined) {
    const existing = await findLocationBySource(deps.pool, sourceReference);

    if (existing !== undefined) {
      return existing;
    }
  }

  const locationId = randomUUID();

  const filled: GeographicContext = {
    neighbourhood: command.payload.context?.neighbourhood ?? null,
    city: command.payload.context?.city ?? null,
    region: command.payload.context?.region ?? null,
    country: command.payload.context?.country ?? null,
    countryCode: command.payload.context?.countryCode ?? null,
  };

  const decision = decideRecordLocation(initialLocationState, {
    locationId,
    recordedByUserId,
    name,
    coordinates,
    precision,
    context: filled,
    sourceReference,
    now: at,
  });

  if (!decision.ok) {
    throw new ValidationError(
      decision.reason === "coordinates_required"
        ? "A place with a known position needs coordinates"
        : "A place whose position is unknown cannot carry coordinates",
      { field: "coordinates" },
    );
  }

  await withTransaction(deps.pool, async (tx) => {
    await recordLocation(tx, {
      locationId,
      recordedByUserId,
      name,
      latitude: coordinates?.latitude,
      longitude: coordinates?.longitude,
      precision,
      neighbourhood: filled.neighbourhood,
      city: filled.city,
      region: filled.region,
      country: filled.country,
      countryCode: filled.countryCode,
      sourceReference,
      createdAt: at,
    });
  });

  await appendEvents({
    client: deps.client,
    streamName: streamName(LOCATION_CATEGORY, locationId),
    events: decision.events,
    metadata: locationEventMetadata(context, recordedByUserId),
    expectedRevision: "no_stream",
  });

  const recorded = await readLocation(deps.pool, locationId);

  if (recorded === undefined) {
    throw new Error(`Recorded location ${locationId} could not be read back`);
  }

  return recorded;
}
