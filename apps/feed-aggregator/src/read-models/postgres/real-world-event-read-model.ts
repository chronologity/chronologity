import { PositionalParameters, realWorldEventVisibleTo } from "@chronologity/moment-access";
import type { Pool } from "pg";

/**
 * Reading one occasion.
 *
 * **Visibility is derived rather than stored**, and the same rule the API
 * applies, from the same package. An Event belongs to nobody — recording one
 * confers no authority over anybody else's history of it — so there is nobody
 * whose setting a visibility flag would be. What decides instead is whether this
 * reader can read a Moment that was part of it, which makes an occasion's
 * existence exactly as private as the history establishing it.
 *
 * Its places come back with it. Those are the Event's own declaration of where
 * the occurrence happened rather than anybody's Moment association, so the
 * per-Moment disclosure ladder does not apply to them — an Event at a venue is
 * not a claim that any particular person was there.
 */

/** An occasion, with its other names and its places. */
export interface RealWorldEventRow {
  readonly real_world_event_id: string;
  readonly name: string;
  readonly aliases: string[] | null;
  readonly occurrence_start: Date;
  readonly occurrence_end: Date;
  readonly occurrence_precision: string;
  readonly locations:
    | {
        locationId: string;
        name: string;
        latitude: string | null;
        longitude: string | null;
        precision: string;
        neighbourhood: string | null;
        city: string | null;
        region: string | null;
        country: string | null;
        countryCode: string | null;
      }[]
    | null;
}

/**
 * Reads occasions for one Viewer at a time.
 */
export class RealWorldEventReadModel {
  /**
   * Build the read model.
   *
   * @param pool - The read-only connection this application holds.
   */
  constructor(private readonly pool: Pool) {}

  /**
   * One occasion, if this reader may know it exists.
   *
   * Aliases and places are gathered by lateral aggregates rather than by two
   * further statements, which is the same batching-in-SQL the discussion read
   * uses: one round trip, and a shape that does not change when loaders arrive.
   *
   * @param realWorldEventId - Which occasion. Compared against a `uuid` column,
   *   so a caller must have checked its shape.
   * @param viewerUserId - Who is asking.
   * @param viewerIsAdult - Whether they are old enough for age-restricted
   *   history, which the Moment rule inside the visibility check asks about.
   * @returns The occasion, or undefined — meaning every refusal at once: there
   *   is no such occasion, or none of its history is readable. A caller must not
   *   distinguish them, because distinguishing them says one exists.
   * @throws {Error} If PostgreSQL refuses the statement.
   */
  async findVisible(
    realWorldEventId: string,
    viewerUserId: string,
    viewerIsAdult: boolean,
  ): Promise<RealWorldEventRow | undefined> {
    const bind = new PositionalParameters();
    const viewer = {
      viewerUserId: bind.bind(viewerUserId),
      viewerIsAdult: bind.bind(viewerIsAdult),
    };
    const id = bind.bind(realWorldEventId);

    const result = await this.pool.query<RealWorldEventRow>(
      `SELECT e.real_world_event_id, e.name,
              e.occurrence_start, e.occurrence_end, e.occurrence_precision,
              alias.list AS aliases,
              place.list AS locations
         FROM real_world_events e
         LEFT JOIN LATERAL (
           SELECT json_agg(a.alias ORDER BY a.alias) AS list
             FROM real_world_event_aliases a
            WHERE a.real_world_event_id = e.real_world_event_id
         ) alias ON true
         LEFT JOIN LATERAL (
           SELECT json_agg(json_build_object(
                    'locationId', l.location_id, 'name', l.name,
                    'latitude', l.latitude, 'longitude', l.longitude,
                    'precision', l.precision, 'neighbourhood', l.neighbourhood,
                    'city', l.city, 'region', l.region, 'country', l.country,
                    'countryCode', l.country_code
                  ) ORDER BY l.name) AS list
             FROM real_world_event_locations rel
             JOIN locations l ON l.location_id = rel.location_id
            WHERE rel.real_world_event_id = e.real_world_event_id
         ) place ON true
        WHERE e.real_world_event_id = ${id}
          AND ${realWorldEventVisibleTo("e", viewer)}`,
      [...bind.values],
    );

    return result.rows[0];
  }
}
