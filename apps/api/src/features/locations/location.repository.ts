import type { Location, LocationPrecision } from "@chronologity/contracts";
import type pg from "pg";
import type { Transaction } from "../../lib/database/transaction.js";
import type { NewLocation } from "./location.types.js";

/**
 * Where places are stored.
 *
 * PostgreSQL is the authority for a Location (ADR-092): what is written here is
 * the record, not a projection of one. Nothing rewrites a row after it is
 * recorded — the map service will rename that venue eventually, and this keeps
 * what it was called when someone was there.
 *
 * Reads take the pool and writes take a transaction, so a write's transaction
 * is visible at the call site rather than hidden behind the method.
 */

interface LocationRow {
  location_id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  precision: string;
  neighbourhood: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  country_code: string | null;
  source_reference: string | null;
  created_at: Date;
}

const COLUMNS = `location_id, name, latitude, longitude, precision,
                 neighbourhood, city, region, country, country_code,
                 source_reference, created_at`;

/**
 * Shape a row into the boundary contract.
 *
 * @param row - As read from `locations`.
 * @returns The place as a caller receives it.
 */
function toLocation(row: LocationRow): Location {
  return {
    locationId: row.location_id,
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
      countryCode: row.country_code,
    },
    sourceReference: row.source_reference,
    createdAt: row.created_at.toISOString(),
  };
}

/** Reads and writes places. */
export class LocationRepository {
  /**
   * Build the Location repository.
   *
   * @param pool - Used for reads. Writes take a transaction of their own, so a
   *   caller cannot accidentally write outside the transaction its change
   *   belongs to.
   */
  constructor(private readonly pool: pg.Pool) {}

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
    const { rows } = await tx.query<LocationRow>(
      `INSERT INTO locations
         (location_id, recorded_by_user_id, name, latitude, longitude, precision,
          neighbourhood, city, region, country, country_code, source_reference, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (source_reference) WHERE source_reference IS NOT NULL DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        location.locationId,
        location.recordedByUserId,
        location.name,
        location.coordinates?.latitude ?? null,
        location.coordinates?.longitude ?? null,
        location.precision,
        location.context.neighbourhood,
        location.context.city,
        location.context.region,
        location.context.country,
        location.context.countryCode,
        location.sourceReference ?? null,
        location.createdAt.toISOString(),
      ],
    );

    const row = rows[0];

    return row === undefined ? undefined : toLocation(row);
  }

  /**
   * Read one place.
   *
   * @param locationId - Which place.
   * @returns The place, or undefined if there is no such record.
   */
  async findById(locationId: string): Promise<Location | undefined> {
    const { rows } = await this.pool.query<LocationRow>(
      `SELECT ${COLUMNS} FROM locations WHERE location_id = $1`,
      [locationId],
    );

    const row = rows[0];

    return row === undefined ? undefined : toLocation(row);
  }

  /**
   * Find the place already recorded for a map-service reference.
   *
   * @param sourceReference - The reference, as `type:id`.
   * @returns The existing place, or undefined. What makes two people choosing
   *   the same search result reach one place rather than two.
   */
  async findBySource(sourceReference: string): Promise<Location | undefined> {
    const { rows } = await this.pool.query<LocationRow>(
      `SELECT ${COLUMNS} FROM locations WHERE source_reference = $1`,
      [sourceReference],
    );

    const row = rows[0];

    return row === undefined ? undefined : toLocation(row);
  }
}
