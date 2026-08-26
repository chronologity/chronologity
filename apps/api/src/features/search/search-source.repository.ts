import type { DataSource } from "typeorm";
import type {
  LocationSource,
  MomentSource,
  RealWorldEventSource,
  UserSource,
} from "./search-document.js";

/**
 * Reading authoritative state to build a Search document.
 *
 * This is the half of the design the open question at `search.md:567` settles:
 * an event says what changed, and the document is built from the database
 * rather than from the payload. Two things follow. A document always reflects
 * current state, so a message replayed long after the fact produces a current
 * answer instead of resurrecting a stale one. And adding a searchable field is
 * a change here rather than a new version of every event that could affect it.
 *
 * The cost is a read per message. It is one indexed lookup against tables the
 * write path just touched, and it buys away an entire class of staleness.
 */
export class SearchSourceRepository {
  /**
   * Build the source repository.
   *
   * @param dataSource - Read only. Nothing here writes.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Everything a Moment's document is built from.
   *
   * One query rather than five, because the five would be five instants and a
   * document assembled across them could describe a Moment that never existed
   * in that shape.
   *
   * @param momentId - Which Moment.
   * @returns Its state, or undefined when there is no such Moment — which the
   *   caller treats as an instruction to remove the document.
   */
  async momentFor(momentId: string): Promise<MomentSource | undefined> {
    const rows: {
      moment_id: string;
      author_user_id: string;
      caption: string;
      occurrence_start: Date;
      occurrence_end: Date;
      occurrence_precision: string;
      visibility: string;
      location_disclosure: string;
      created_at: Date;
      deleted_at: Date | null;
      moderation_state: string | null;
      place_name: string | null;
      latitude: number | null;
      longitude: number | null;
      event_names: string[] | null;
    }[] = await this.dataSource.query(
      `SELECT m.moment_id, m.author_user_id, m.caption,
              m.occurrence_start, m.occurrence_end, m.occurrence_precision,
              m.visibility, m.location_disclosure, m.created_at, m.deleted_at,
              ms.state AS moderation_state,
              l.name AS place_name, l.latitude, l.longitude,
              ARRAY(
                SELECT rwe.name
                  FROM moment_real_world_events mre
                  JOIN real_world_events rwe
                    ON rwe.real_world_event_id = mre.real_world_event_id
                 WHERE mre.moment_id = m.moment_id
                 ORDER BY rwe.name
              ) AS event_names
         FROM moments m
         LEFT JOIN moderation_states ms
           ON ms.subject_type = 'moment' AND ms.subject_id = m.moment_id
         LEFT JOIN moment_locations mloc ON mloc.moment_id = m.moment_id
         LEFT JOIN locations l ON l.location_id = mloc.location_id
        WHERE m.moment_id = $1`,
      [momentId],
    );

    const row = rows[0];

    if (row === undefined) {
      return undefined;
    }

    return {
      momentId: row.moment_id,
      authorUserId: row.author_user_id,
      caption: row.caption,
      occurrenceStart: row.occurrence_start,
      occurrenceEnd: row.occurrence_end,
      occurrencePrecision: row.occurrence_precision,
      visibility: row.visibility,
      locationDisclosure: row.location_disclosure,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
      moderationState: row.moderation_state ?? undefined,
      placeName: row.place_name ?? undefined,
      latitude: row.latitude ?? undefined,
      longitude: row.longitude ?? undefined,
      realWorldEventNames: row.event_names ?? [],
    };
  }

  /**
   * Everything an account's document is built from.
   *
   * @param userId - Which account.
   * @returns Its state, or undefined when there is no such account.
   */
  async userFor(userId: string): Promise<UserSource | undefined> {
    const rows: {
      user_id: string;
      handle: string;
      display_name: string;
      biography: string | null;
      created_at: Date;
      moderation_state: string | null;
    }[] = await this.dataSource.query(
      `SELECT u.user_id, u.handle, u.display_name, u.biography, u.created_at,
              ms.state AS moderation_state
         FROM users u
         LEFT JOIN moderation_states ms
           ON ms.subject_type = 'user' AND ms.subject_id = u.user_id
        WHERE u.user_id = $1`,
      [userId],
    );

    const row = rows[0];

    return row === undefined
      ? undefined
      : {
          userId: row.user_id,
          handle: row.handle,
          displayName: row.display_name,
          biography: row.biography,
          createdAt: row.created_at,
          moderationState: row.moderation_state ?? undefined,
        };
  }

  /**
   * Everything a real-world Event's document is built from.
   *
   * @param realWorldEventId - Which Event.
   * @returns Its state with its aliases, or undefined when there is no such
   *   Event.
   */
  async realWorldEventFor(
    realWorldEventId: string,
  ): Promise<RealWorldEventSource | undefined> {
    const rows: {
      real_world_event_id: string;
      name: string;
      occurrence_start: Date;
      occurrence_end: Date;
      occurrence_precision: string;
      created_at: Date;
      alias_names: string[] | null;
    }[] = await this.dataSource.query(
      `SELECT e.real_world_event_id, e.name,
              e.occurrence_start, e.occurrence_end, e.occurrence_precision,
              e.created_at,
              ARRAY(
                SELECT a.alias FROM real_world_event_aliases a
                 WHERE a.real_world_event_id = e.real_world_event_id
                 ORDER BY a.alias
              ) AS alias_names
         FROM real_world_events e
        WHERE e.real_world_event_id = $1`,
      [realWorldEventId],
    );

    const row = rows[0];

    // No moderation state: `moment`, `comment`, `user`, and `media` are the
    // subject types moderation recognises, and a real-world Event is none of
    // them. Shared history has no author to hold responsible, and removing the
    // First World War from Search is not a moderation decision anybody should
    // be able to make through this path.
    return row === undefined
      ? undefined
      : {
          realWorldEventId: row.real_world_event_id,
          name: row.name,
          occurrenceStart: row.occurrence_start,
          occurrenceEnd: row.occurrence_end,
          occurrencePrecision: row.occurrence_precision,
          createdAt: row.created_at,
          aliasNames: row.alias_names ?? [],
          moderationState: undefined,
        };
  }

  /**
   * Everything a Location's document is built from.
   *
   * @param locationId - Which Location.
   * @returns Its state, or undefined when there is no such Location.
   */
  async locationFor(locationId: string): Promise<LocationSource | undefined> {
    const rows: {
      location_id: string;
      name: string;
      latitude: number | null;
      longitude: number | null;
      city: string | null;
      region: string | null;
      country: string | null;
      created_at: Date;
    }[] = await this.dataSource.query(
      `SELECT location_id, name, latitude, longitude, city, region, country, created_at
         FROM locations WHERE location_id = $1`,
      [locationId],
    );

    const row = rows[0];

    // As with Events, reference data has no moderation state and no author.
    return row === undefined
      ? undefined
      : {
          locationId: row.location_id,
          name: row.name,
          latitude: row.latitude,
          longitude: row.longitude,
          // What somebody types when they cannot remember the venue but
          // remember the city. Carried as alternates rather than in the title,
          // which stays the name of the place itself.
          alternateNames: [row.city, row.region, row.country].filter(
            (part): part is string => part !== null && part.length > 0,
          ),
          createdAt: row.created_at,
          moderationState: undefined,
        };
  }

  /**
   * Every entity of one type, oldest first, for a rebuild.
   *
   * Paged on the identifier rather than an offset, so a rebuild running while
   * the indexer writes cannot skip or repeat a row as the set shifts under it.
   *
   * @param table - Which table.
   * @param idColumn - Its identifier column.
   * @param after - Continue past this identifier, or undefined to start.
   * @param limit - How many at most.
   * @returns The identifiers.
   */
  async idsAfter(
    table: string,
    idColumn: string,
    after: string | undefined,
    limit: number,
  ): Promise<string[]> {
    // The table and column are not caller input: the rebuild names them from a
    // fixed list, and there is no query-parameter form for an identifier.
    const rows: Record<string, string>[] = await this.dataSource.query(
      `SELECT ${idColumn} FROM ${table}
        WHERE $1::uuid IS NULL OR ${idColumn} > $1::uuid
        ORDER BY ${idColumn}
        LIMIT $2`,
      [after ?? null, limit],
    );

    return rows.map((row) => String(row[idColumn]));
  }
}
