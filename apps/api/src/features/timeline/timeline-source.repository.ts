import type { DataSource } from "typeorm";

/** A Moment as authoritative state has it, for the Timeline's purposes. */
export interface TimelineSource {
  readonly momentId: string;
  readonly authorUserId: string;
  readonly occurrenceStart: Date;
  readonly occurrenceEnd: Date;
  readonly occurrencePrecision: string;
  readonly occurrenceOffsetMinutes: number;
  readonly visibility: string;
  readonly discoverable: boolean;
  readonly deletedAt: Date | null;
  readonly moderationState: string | undefined;
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
 * **What this deliberately does not read is the author's account status.**
 * `search.eligibility.ts` establishes the shape: a projection carries what is
 * intrinsic to the thing — its occurrence, its visibility, whether moderation
 * permits it at all — and everything depending on who is asking, or on state
 * that changes without the Moment changing, is resolved when the query runs.
 * Author suspension is the second kind. Baking it into the row would mean
 * reprojecting every Moment somebody ever recorded each time their account was
 * suspended or restored, and leaving the Timeline wrong in between.
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
      occurrence_end: Date;
      occurrence_precision: string;
      occurrence_offset_minutes: number;
      visibility: string;
      discoverable: boolean;
      deleted_at: Date | null;
      moderation_state: string | null;
    }[] = await this.dataSource.query(
      `SELECT m.moment_id, m.author_user_id,
              m.occurrence_start, m.occurrence_end, m.occurrence_precision,
              m.occurrence_offset_minutes,
              m.visibility, m.discoverable, m.deleted_at,
              ms.state AS moderation_state
         FROM moments m
         LEFT JOIN moderation_states ms
           ON ms.subject_type = 'moment' AND ms.subject_id = m.moment_id
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
      occurrenceEnd: row.occurrence_end,
      occurrencePrecision: row.occurrence_precision,
      occurrenceOffsetMinutes: row.occurrence_offset_minutes,
      visibility: row.visibility,
      discoverable: row.discoverable,
      deletedAt: row.deleted_at,
      moderationState: row.moderation_state ?? undefined,
    };
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
