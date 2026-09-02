import { randomUUID } from "node:crypto";
import type { CreateRealWorldEventRequest, RealWorldEvent } from "@chronologity/contracts";
import { REAL_WORLD_EVENTS_BOUNDARY } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { withTransaction } from "../../lib/database/transaction.js";
import { enqueueOutboxMessage } from "../../lib/database/outbox.js";
import { topicName } from "../../lib/messaging/topics.js";
import type { RequestContext } from "../../types/request-context.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import type { LocationRepository } from "../locations/location.repository.js";
import {
  checkOccurrence,
  describeOccurrenceRejection,
  distinctAliases,
  distinctLocationIds,
} from "./real-world-event.policy.js";
import type { RealWorldEventRepository } from "./real-world-event.repository.js";

/**
 * Recording and reading real-world Events.
 *
 * An Event is the occurrence several people's Moments have in common — a
 * convention, a wedding, an election. It is not a container: Moments belong to
 * whoever recorded them, and an Event only says they share an occurrence.
 *
 * Identity is ours, and it is not the name. Two people recording "Anime NYC"
 * separately produce two Events, and that is correct rather than a fault to
 * prevent: duplicates are expected before reconciliation exists, and refusing
 * them would refuse real history to protect a guess
 * (`real-world-events.md:583-615`).
 *
 * Nothing here changes an Event after it is recorded. Correction, merging,
 * splitting, hierarchy, descriptions, and who may do any of it are all still
 * open product questions, and guessing now means unpicking later.
 */
export class RealWorldEventService {
  /**
   * Build the real-world Event service.
   *
   * @param dataSource - Opens the transactions this service's writes commit in.
   * @param events - Where Events are stored.
   * @param locations - Used to check that a place named actually exists.
   *   Reached through its repository rather than a foreign key alone so the
   *   refusal is a stated one rather than a constraint violation.
   * @param clock - Injected so tests can move time without waiting.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: RealWorldEventRepository,
    private readonly locations: LocationRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Record a real-world Event.
   *
   * @param createdByUserId - Who is recording it. Provenance, never ownership:
   *   recording the first entry for a public occurrence confers no authority
   *   over anyone else's history of it.
   * @param request - The name, other names it goes by, when it happened, and
   *   where.
   * @param context - The request that caused this, so the hop into
   *   asynchronous indexing stays joined to it. Absent where no request did.
   * @returns The Event as recorded.
   * @throws {ValidationError} If the occurrence ends before it starts, if an
   *   instant spans two moments, or if a place named does not exist.
   */
  async record(
    createdByUserId: string,
    request: CreateRealWorldEventRequest,
    context: RequestContext,
  ): Promise<RealWorldEvent> {
    const rejection = checkOccurrence(request.occurrence);

    if (rejection !== undefined) {
      throw new ValidationError(describeOccurrenceRejection(rejection), { field: "occurrence" });
    }

    const locationIds = distinctLocationIds(request.locationIds);

    // Checked before writing so the refusal names the place that is missing.
    // The foreign key would refuse this too, but as a constraint violation
    // nobody can act on.
    for (const locationId of locationIds) {
      if ((await this.locations.findById(locationId)) === undefined) {
        throw new ValidationError("No such location", { field: "locationIds" });
      }
    }

    const realWorldEventId = randomUUID();
    const name = request.name.trim();

    await withTransaction(this.dataSource, async (tx) => {
      await this.events.insert(tx, {
        realWorldEventId,
        createdByUserId,
        name,
        aliases: distinctAliases(name, request.aliases),
        occurrence: request.occurrence,
        locationIds,
        createdAt: this.clock(),
      });

      // Shared history, so the payload names nobody: an Event has no author
      // whose privacy or suspension could decide whether it is findable.
      const traceId = context.traceId;

      await enqueueOutboxMessage(tx, {
        topic: topicName(REAL_WORLD_EVENTS_BOUNDARY),
        partitionKey: realWorldEventId,
        aggregateType: "real_world_event",
        aggregateId: realWorldEventId,
        aggregateVersion: 0,
        eventType: "RealWorldEventRecorded",
        eventVersion: 1,
        payload: { realWorldEventId, recordedAt: this.clock().toISOString() },
        metadata: {
          traceId,
          correlationId: traceId,
          causationId: undefined,
          actorUserId: createdByUserId,
          eventVersion: 1,
          recordedAt: context.receivedAt.toISOString(),
        },
      });
    });

    const recorded = await this.events.findById(realWorldEventId);

    if (recorded === undefined) {
      throw new Error("A real-world Event was not found immediately after being recorded");
    }

    return recorded;
  }

  /**
   * Read one Event.
   *
   * Any authenticated caller may read one. Event visibility is deliberately
   * unbuilt: the specification is explicit that an Event's *existence* can
   * itself be sensitive, and deciding who sees what requires Moments, viewers,
   * and audiences that do not exist yet. Nothing is exposed meanwhile, because
   * nothing enumerates Events and no Moment points at one.
   *
   * @param realWorldEventId - Which Event.
   * @returns The Event.
   * @throws {NotFoundError} If there is no such Event.
   */
  async get(realWorldEventId: string): Promise<RealWorldEvent> {
    const event = await this.events.findById(realWorldEventId);

    if (event === undefined) {
      throw new NotFoundError("No such real-world event");
    }

    return event;
  }
}
