import type { Occurrence, RealWorldEvent, TemporalPrecision } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import {
  RealWorldEvent as EventRow,
  RealWorldEventAlias,
  RealWorldEventLocation,
} from "./real-world-event.model.js";
import type { NewRealWorldEvent } from "./real-world-event.types.js";

/**
 * Where real-world Events are stored.
 *
 * PostgreSQL is the authority (ADR-092): what is written here is the record,
 * not a projection of one.
 *
 * Reads take the DataSource and writes take a transaction, so a write's
 * transaction is visible at the call site — an Event, its aliases, and its
 * places are one record written three ways, and half of it committing would be
 * a half-recorded occurrence.
 *
 * The entity is imported as `EventRow` because `RealWorldEvent` is the contract
 * this returns, and the two are deliberately different shapes.
 */

/**
 * Shape a row and its attachments into the boundary contract.
 *
 * Exported because a Moment returns the occurrences it was part of whole rather
 * than by identifier. The caller must have loaded the aliases and places, since
 * this reports what it was given: an Event read without them looks like one
 * with none.
 *
 * @param row - As read from `real_world_events`, with aliases and places
 *   loaded.
 * @returns The Event as a caller receives it.
 */
export function toRealWorldEvent(row: EventRow): RealWorldEvent {
  const occurrence: Occurrence = {
    start: row.occurrenceStart.toISOString(),
    end: row.occurrenceEnd.toISOString(),
    precision: row.occurrencePrecision as TemporalPrecision,
  };

  return {
    realWorldEventId: row.realWorldEventId,
    name: row.name,
    // Ordered so a caller sees the same list twice running. The database has
    // no opinion, and an unstable order would surface as spurious diffs.
    aliases: (row.aliases ?? []).map((alias) => alias.alias).sort(),
    occurrence,
    locationIds: (row.locations ?? []).map((place) => place.locationId).sort(),
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Reads and writes real-world Events. */
export class RealWorldEventRepository {
  /**
   * Build the real-world Event repository.
   *
   * @param dataSource - Used for reads. Writes take a transaction of their own,
   *   so a caller cannot accidentally write outside the transaction its change
   *   belongs to.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Record an Event, its other names, and where it happened.
   *
   * @param tx - The caller's transaction. All three writes share it: an Event
   *   whose places did not commit is a different historical claim from the one
   *   that was made.
   * @param event - Everything established when it was recorded.
   * @returns Nothing. There is no conflict to report — duplicates are expected
   *   and the identifier is ours, so this either writes or throws.
   */
  async insert(tx: Transaction, event: NewRealWorldEvent): Promise<void> {
    await tx.insert(EventRow, {
      realWorldEventId: event.realWorldEventId,
      createdByUserId: event.createdByUserId,
      name: event.name,
      occurrenceStart: new Date(event.occurrence.start),
      occurrenceEnd: new Date(event.occurrence.end),
      occurrencePrecision: event.occurrence.precision,
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
    });

    if (event.aliases.length > 0) {
      await tx.insert(
        RealWorldEventAlias,
        event.aliases.map((alias) => ({
          realWorldEventId: event.realWorldEventId,
          alias,
          createdAt: event.createdAt,
        })),
      );
    }

    if (event.locationIds.length > 0) {
      await tx.insert(
        RealWorldEventLocation,
        event.locationIds.map((locationId) => ({
          realWorldEventId: event.realWorldEventId,
          locationId,
          createdAt: event.createdAt,
        })),
      );
    }
  }

  /**
   * Read one Event.
   *
   * @param realWorldEventId - Which Event.
   * @returns The Event with its other names and places, or undefined if there
   *   is no such record.
   */
  async findById(realWorldEventId: string): Promise<RealWorldEvent | undefined> {
    const row = await this.dataSource.getRepository(EventRow).findOne({
      where: { realWorldEventId },
      relations: { aliases: true, locations: true },
    });

    return row === null ? undefined : toRealWorldEvent(row);
  }
}
