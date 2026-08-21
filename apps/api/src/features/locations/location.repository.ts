import type { Location, LocationPrecision, LocationSource } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import { Location as LocationRow } from "./location.model.js";
import type { NewLocation } from "./location.types.js";

/**
 * Where places are stored.
 *
 * PostgreSQL is the authority for a Location (ADR-092): what is written here is
 * the record, not a projection of one. Nothing rewrites a row after it is
 * recorded — the map service will rename that venue eventually, and this keeps
 * what it was called when someone was there.
 *
 * Reads take the DataSource and writes take a transaction, so a write's
 * transaction is visible at the call site rather than hidden behind the method.
 *
 * The entity is imported as `LocationRow` because `Location` is the contract
 * this returns, and the two are deliberately different shapes.
 */

/**
 * Shape a row into the boundary contract.
 *
 * @param row - As read from `locations`.
 * @returns The place as a caller receives it.
 */
function toLocation(row: LocationRow): Location {
  return {
    locationId: row.locationId,
    name: row.name,
    coordinates:
      row.latitude === null || row.longitude === null
        ? null
        : { latitude: row.latitude, longitude: row.longitude },
    precision: row.precision as LocationPrecision,
    context: {
      neighbourhood: row.neighbourhood,
      city: row.city,
      region: row.region,
      country: row.country,
      countryCode: row.countryCode,
    },
    sourceReference: row.sourceReference,
    source: row.source as LocationSource,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Reads and writes places. */
export class LocationRepository {
  /**
   * Build the Location repository.
   *
   * @param dataSource - Used for reads. Writes take a transaction of their own,
   *   so a caller cannot accidentally write outside the transaction its change
   *   belongs to.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Record a place, unless the same map-service result already reached one.
   *
   * @param tx - The caller's transaction.
   * @param location - Everything established when it was recorded.
   * @returns The place as recorded, or undefined when a place already carries
   *   this source reference. Written as one statement rather than a check
   *   followed by an insert, because the check and the insert are two moments
   *   and two people choosing the same search result can arrive between them.
   *   The unique index decides, not the application.
   */
  async insert(tx: Transaction, location: NewLocation): Promise<Location | undefined> {
    // `orIgnore` is ON CONFLICT DO NOTHING. A conflicting insert identifies
    // nothing, which is what distinguishes recording the place from losing to
    // somebody who recorded it first.
    const inserted = await tx
      .createQueryBuilder()
      .insert()
      .into(LocationRow)
      .values({
        locationId: location.locationId,
        recordedByUserId: location.recordedByUserId,
        name: location.name,
        latitude: location.coordinates?.latitude ?? null,
        longitude: location.coordinates?.longitude ?? null,
        precision: location.precision,
        neighbourhood: location.context.neighbourhood,
        city: location.context.city,
        region: location.context.region,
        country: location.context.country,
        countryCode: location.context.countryCode,
        sourceReference: location.sourceReference ?? null,
        source: location.source,
        createdAt: location.createdAt,
        updatedAt: location.createdAt,
      })
      .orIgnore()
      // Explicit, because the identifiers a conflicting insert reports are the
      // ones handed to it rather than the ones written. RETURNING is what
      // actually distinguishes a row that landed from one that did not.
      .returning(["locationId"])
      .execute();

    if ((inserted.raw as unknown[]).length !== 1) {
      return undefined;
    }

    const row = await tx.findOneBy(LocationRow, { locationId: location.locationId });

    return row === null ? undefined : toLocation(row);
  }

  /**
   * Read one place.
   *
   * @param locationId - Which place.
   * @returns The place, or undefined if there is no such record.
   */
  async findById(locationId: string): Promise<Location | undefined> {
    const row = await this.dataSource.getRepository(LocationRow).findOneBy({ locationId });

    return row === null ? undefined : toLocation(row);
  }

  /**
   * Find the place already recorded for a map-service reference.
   *
   * @param sourceReference - The reference, as `type:id`.
   * @returns The existing place, or undefined. What makes two people choosing
   *   the same search result reach one place rather than two.
   */
  async findBySource(sourceReference: string): Promise<Location | undefined> {
    const row = await this.dataSource.getRepository(LocationRow).findOneBy({ sourceReference });

    return row === null ? undefined : toLocation(row);
  }
}
