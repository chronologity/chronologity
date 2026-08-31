import type { DataSource } from "typeorm";

/** A Moment as authoritative state has it, for the Timeline's purposes. */
export interface TimelineSource {
  readonly momentId: string;
  readonly authorUserId: string;
  readonly occurrenceStart: Date;
  /** When the Moment was recorded, which chronology never uses. */
  readonly recordedAt: Date;
  readonly occurrenceEnd: Date;
  readonly occurrencePrecision: string;
  readonly occurrenceOffsetMinutes: number;
  readonly visibility: string;
  readonly discoverable: boolean;
  readonly deletedAt: Date | null;
  readonly moderationState: string | undefined;
  /** The Location it names, if any. A Moment has at most one. */
  readonly locationId: string | undefined;
  /** The real-world Events it names. A Moment may name several. */
  readonly realWorldEventIds: readonly string[];
  /**
   * Who has agreed they were part of it.
   *
   * Accepted participations only. Their Timelines carry the Moment as much as
   * the author's does, which is what `timelines.md:176` means by a person's
   * history being what they authored *together with* what they took part in.
   */
  readonly participantUserIds: readonly string[];
}

/**
 * Reading authoritative state to build a Timeline row.
 *
 * The event says which Moment changed; the row is built from the database. Same
 * arrangement as `SearchSourceRepository`, and for the same two reasons: a
 * message replayed long after the fact produces a current answer instead of
 * resurrecting a stale one, and adding a column to the projection is a change
 * here rather than a new version of every event that could affect it.
 *
 * **No Timeline row this builds carries the author's account status.**
 * `search.eligibility.ts` establishes the shape: a projection carries what is
 * intrinsic to the thing — its occurrence, its visibility, whether moderation
 * permits it at all — and everything depending on who is asking, or on state
 * that changes without the Moment changing, is resolved when the query runs.
 * Author suspension is the second kind. Baking it into the row would mean
 * reprojecting every Moment somebody ever recorded each time their account was
 * suspended or restored, and leaving the Timeline wrong in between.
 *
 * `everySuspendedAuthor` reads that status all the same, and does not
 * contradict the above: it feeds the separate dimension the query joins, one
 * row per suspended account rather than a field on every Moment. The rule is
 * that status never enters a Moment's row, not that this file never asks.
 */
export class TimelineSourceRepository {
  /**
   * Build the source repository.
   *
   * @param dataSource - Read only. Nothing here writes.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Everything a Moment's Timeline row is built from.
   *
   * @param momentId - Which Moment.
   * @returns Its state, or undefined when there is no such Moment — which the
   *   caller treats as an instruction to remove the row rather than as an
   *   error, since a Moment erased between the event and this read is ordinary.
   */
  async momentFor(momentId: string): Promise<TimelineSource | undefined> {
    const rows: {
      moment_id: string;
      author_user_id: string;
      occurrence_start: Date;
      created_at: Date;
      occurrence_end: Date;
      occurrence_precision: string;
      occurrence_offset_minutes: number;
      visibility: string;
      discoverable: boolean;
      deleted_at: Date | null;
      moderation_state: string | null;
      location_id: string | null;
      real_world_event_ids: string[] | null;
      participant_user_ids: string[] | null;
    }[] = await this.dataSource.query(
      `SELECT m.moment_id, m.author_user_id, m.created_at,
              m.occurrence_start, m.occurrence_end, m.occurrence_precision,
              m.occurrence_offset_minutes,
              m.visibility, m.discoverable, m.deleted_at,
              ms.state AS moderation_state,
              mloc.location_id,
              ARRAY(
                SELECT mre.real_world_event_id
                  FROM moment_real_world_events mre
                 WHERE mre.moment_id = m.moment_id
                 ORDER BY mre.real_world_event_id
              ) AS real_world_event_ids,
              -- Accepted only. A proposal is a question between two people, and
              -- projecting one would put a Moment on the Timeline of somebody
              -- who has not agreed they were there — which is the assertion the
              -- whole consent model exists to prevent.
              --
              -- Ordered by the account rather than by when it was proposed, so
              -- the projected set is deterministic: the same Moment reprojected
              -- must produce the same rows or a rebuild would churn.
              ARRAY(
                SELECT mp.user_id
                  FROM moment_participations mp
                 WHERE mp.moment_id = m.moment_id
                   AND mp.status = 'accepted'
                 ORDER BY mp.user_id
              ) AS participant_user_ids
         FROM moments m
         LEFT JOIN moderation_states ms
           ON ms.subject_type = 'moment' AND ms.subject_id = m.moment_id
         LEFT JOIN moment_locations mloc ON mloc.moment_id = m.moment_id
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
      occurrenceStart: row.occurrence_start,
      recordedAt: row.created_at,
      occurrenceEnd: row.occurrence_end,
      occurrencePrecision: row.occurrence_precision,
      occurrenceOffsetMinutes: row.occurrence_offset_minutes,
      visibility: row.visibility,
      discoverable: row.discoverable,
      deletedAt: row.deleted_at,
      moderationState: row.moderation_state ?? undefined,
      locationId: row.location_id ?? undefined,
      realWorldEventIds: row.real_world_event_ids ?? [],
      participantUserIds: row.participant_user_ids ?? [],
    };
  }

  /**
   * Every account whose history is currently withheld.
   *
   * Read by a full rebuild, which has to restore the suspension dimension
   * alongside the Moments — a rebuild that put every Moment back and left this
   * stale would return a projection showing history moderation had withheld.
   *
   * Unbounded on purpose, and safe to be: this is the count of suspended
   * accounts rather than of Moments, and the whole reason the dimension exists
   * as its own table is that the first number stays small while the second
   * does not.
   *
   * @returns The identifiers, in no particular order.
   * @throws {Error} If the database refuses.
   */
  async everySuspendedAuthor(): Promise<string[]> {
    const rows: { user_id: string }[] = await this.dataSource.query(
      // Suspension and nothing else, worded to match `moderationPermits` in
      // `moment.repository.ts` and `isSuspended` in the moderation repository.
      // A twin here that also caught `deactivated` would quietly change what
      // deactivation means.
      `SELECT user_id FROM users WHERE status = 'suspended'`,
    );

    return rows.map((row) => row.user_id);
  }

  /**
   * Every Moment that belongs on the Timeline, oldest first.
   *
   * For rebuilding. Ordered by occurrence so a partial rebuild fills history
   * from its beginning rather than in whatever order the table returns.
   *
   * @param after - Resume from the Moment after this occurrence and identifier,
   *   so a rebuild is resumable rather than restarting.
   * @param limit - How many at most.
   * @returns Identifiers, oldest first.
   */
  async everyMoment(
    after: { occurredAt: Date; momentId: string } | undefined,
    limit: number,
  ): Promise<string[]> {
    const rows: { moment_id: string }[] = await this.dataSource.query(
      `SELECT moment_id FROM moments
        WHERE deleted_at IS NULL
          AND ($1::timestamptz IS NULL
               OR (occurrence_start, moment_id) > ($1::timestamptz, $2::uuid))
        ORDER BY occurrence_start ASC, moment_id ASC
        LIMIT $3`,
      [after?.occurredAt ?? null, after?.momentId ?? null, limit],
    );

    return rows.map((row) => row.moment_id);
  }
}
