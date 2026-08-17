import type { Location, LocationPrecision } from "@chronologity/contracts";
import type pg from "pg";
import type { Transaction } from "../../../lib/database/transaction.js";

/**
 * The Location read model.
 *
 * Written in the same transaction as the decision it reflects. The aggregate
 * remains the authority; this is what the product reads.
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

/**
 * Record a place.
 *
 * @param tx - The caller's transaction.
 * @param input - Everything established when it was recorded.
 * @returns Nothing.
 */
export async function recordLocation(
  tx: Transaction,
  input: {
    locationId: string;
    recordedByUserId: string;
    name: string;
    latitude: number | undefined;
    longitude: number | undefined;
    precision: LocationPrecision;
    neighbourhood: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
    countryCode: string | null;
    sourceReference: string | undefined;
    createdAt: Date;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO locations
       (location_id, recorded_by_user_id, name, latitude, longitude, precision,
        neighbourhood, city, region, country, country_code, source_reference, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      input.locationId,
      input.recordedByUserId,
      input.name,
      input.latitude ?? null,
      input.longitude ?? null,
      input.precision,
      input.neighbourhood,
      input.city,
      input.region,
      input.country,
      input.countryCode,
      input.sourceReference ?? null,
      input.createdAt.toISOString(),
    ],
  );
}

/**
 * Read one place.
 *
 * @param pool - Read-only use.
 * @param locationId - Which place.
 * @returns The place, or undefined if there is no such record.
 */
export async function readLocation(
  pool: pg.Pool,
  locationId: string,
): Promise<Location | undefined> {
  const { rows } = await pool.query<LocationRow>(
    `SELECT ${COLUMNS} FROM locations WHERE location_id = $1`,
    [locationId],
  );

  const row = rows[0];

  return row === undefined ? undefined : toLocation(row);
}

/**
 * Find the place already recorded for a map-service reference.
 *
 * @param pool - Read-only use.
 * @param sourceReference - The reference, as `type:id`.
 * @returns The existing place, or undefined. What stops two people choosing
 *   the same search result from creating two records of the same place — and
 *   why the reference carries a unique index rather than this check being
 *   trusted on its own.
 */
export async function findLocationBySource(
  pool: pg.Pool,
  sourceReference: string,
): Promise<Location | undefined> {
  const { rows } = await pool.query<LocationRow>(
    `SELECT ${COLUMNS} FROM locations WHERE source_reference = $1`,
    [sourceReference],
  );

  const row = rows[0];

  return row === undefined ? undefined : toLocation(row);
}
