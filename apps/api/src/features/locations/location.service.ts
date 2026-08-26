import { randomUUID } from "node:crypto";
import type {
  Coordinates,
  CreateLocationRequest,
  Location,
  PlaceSuggestions,
} from "@chronologity/contracts";
import { LOCATIONS_BOUNDARY } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { withTransaction } from "../../lib/database/transaction.js";
import { enqueueOutboxMessage } from "../../lib/database/outbox.js";
import { topicName } from "../../lib/messaging/topics.js";
import type { RequestContext } from "../../types/request-context.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import type { PlaceSearchClient } from "../../integrations/places/place-search-client.js";
import { checkPosition, describeLocationRejection, fillContext } from "./location.policy.js";
import type { LocationRepository } from "./location.repository.js";

/**
 * Recording and reading places.
 *
 * A Location is a place, not a coordinate. `40.7505, -73.9934` is a
 * measurement; "Madison Square Garden" is a place, and the same ground holds
 * different places over time. So this records what a place was understood to be
 * when someone recorded it, and happens to carry coordinates.
 *
 * Identity is ours. When someone picks a search result, a record is created
 * with its own identifier and the map service's reference is kept as
 * provenance; without that, a rename by the service would rewrite history.
 *
 * Nothing here changes a place after it is recorded. Corrections, merges, and
 * names that change over time are real and deferred: `locations.md` still lists
 * them among its open questions, and guessing now means unpicking later.
 */
export class LocationService {
  /**
   * Build the Location service.
   *
   * @param dataSource - Opens the transactions this service's writes commit in.
   * @param locations - Where places are stored.
   * @param places - Looks places up in the map service. Answered from recorded
   *   responses in tests, so the suite never calls OpenStreetMap.
   * @param clock - Injected so tests can move time without waiting.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly locations: LocationRepository,
    private readonly places: PlaceSearchClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Look for places matching what someone typed.
   *
   * Creates nothing. What comes back are candidates; a Location exists only
   * once someone chooses one.
   *
   * @param query - What they typed.
   * @param limit - How many candidates to return.
   * @returns Candidates and the attribution the data must be shown with. The
   *   attribution is not optional: OpenStreetMap is licensed under ODbL, which
   *   requires crediting contributors wherever the data appears.
   * @throws {Error} If the map service could not be reached.
   */
  async searchPlaces(query: string, limit?: number): Promise<PlaceSuggestions> {
    return this.places.search(query, limit);
  }

  /**
   * Record a place.
   *
   * @param recordedByUserId - Who is recording it.
   * @param request - The name, position, how precisely it is known, the wider
   *   areas it sits inside, an optional map-service reference, and how the
   *   place came to be known. A request that says nothing about its source is
   *   describing somebody typing a name in, which is the strongest claim
   *   there is — so a weaker one has to be stated.
   * @param context - The request that caused this, so the hop into
   *   asynchronous indexing stays joined to it. Absent where no request did.
   * @returns The place. When the same map-service reference has already been
   *   recorded the existing place is returned rather than a second one created,
   *   and the name it was first given stands — two people choosing the same
   *   search result mean the same place, and the first name recorded is the one
   *   a Moment from that time should carry.
   * @throws {ValidationError} If a known position carries no coordinates, or an
   *   unknown one carries them.
   */
  async record(
    recordedByUserId: string,
    request: CreateLocationRequest,
    context?: RequestContext,
  ): Promise<Location> {
    const rejection = checkPosition(request.precision, request.coordinates);

    if (rejection !== undefined) {
      throw new ValidationError(describeLocationRejection(rejection), { field: "coordinates" });
    }

    const { sourceReference } = request;

    // Asked before writing so the common case costs one read rather than a
    // failed insert. It is not what makes this correct under concurrency —
    // the insert below is.
    if (sourceReference !== undefined) {
      const existing = await this.locations.findBySource(sourceReference);

      if (existing !== undefined) {
        return existing;
      }
    }

    const recorded = await withTransaction(this.dataSource, async (tx) => {
      const location = await this.locations.insert(tx, {
        locationId: randomUUID(),
        recordedByUserId,
        name: request.name,
        coordinates: request.coordinates,
        precision: request.precision,
        context: fillContext(request.context),
        sourceReference,
        source: request.source ?? "explicit-selection",
        createdAt: this.clock(),
      });

      if (location === undefined) {
        // Somebody recorded this place first. Nothing was written, so there is
        // nothing to announce: an event here would tell the indexer to rebuild
        // a document for a Location this call did not create.
        return location;
      }

      // Shared reference data, so the payload names nobody. What a Moment
      // discloses about having been here is decided on the Moment.
      const traceId = context?.traceId ?? randomUUID();

      await enqueueOutboxMessage(tx, {
        topic: topicName(LOCATIONS_BOUNDARY),
        partitionKey: location.locationId,
        aggregateType: "location",
        aggregateId: location.locationId,
        aggregateVersion: 0,
        eventType: "LocationRecorded",
        eventVersion: 1,
        payload: { locationId: location.locationId, recordedAt: this.clock().toISOString() },
        metadata: {
          traceId,
          correlationId: traceId,
          causationId: undefined,
          actorUserId: recordedByUserId,
          eventVersion: 1,
          recordedAt: (context?.receivedAt ?? this.clock()).toISOString(),
        },
      });

      return location;
    });

    if (recorded !== undefined) {
      return recorded;
    }

    // The insert found this source reference already taken, which means someone
    // committed between the read above and the write. They won; their place is
    // the place.
    const winner =
      sourceReference === undefined
        ? undefined
        : await this.locations.findBySource(sourceReference);

    if (winner === undefined) {
      throw new Error("A place was neither recorded nor found after a conflicting write");
    }

    return winner;
  }

  /**
   * Ask what places are at a position.
   *
   * Used for a position that came from somewhere other than a search — a
   * photograph's own metadata, or a device. Creates nothing: what comes back
   * are candidates, and a Location exists only once somebody chooses one.
   *
   * @param coordinates - Where to ask about.
   * @returns Candidates and the attribution the data must be shown with.
   * @throws {Error} If the map service could not be reached.
   */
  async suggestFor(coordinates: Coordinates): Promise<PlaceSuggestions> {
    return this.places.reverse(coordinates);
  }

  /**
   * Read one place.
   *
   * Anyone authenticated may read a place. A Location carries no privacy of its
   * own yet — what limits who sees how precisely is 5F-3, and it attaches to the
   * Moment a place is used by rather than to the place itself.
   *
   * @param locationId - Which place.
   * @returns The place.
   * @throws {NotFoundError} If there is no such place.
   */
  async get(locationId: string): Promise<Location> {
    const location = await this.locations.findById(locationId);

    if (location === undefined) {
      throw new NotFoundError("No such location");
    }

    return location;
  }
}
