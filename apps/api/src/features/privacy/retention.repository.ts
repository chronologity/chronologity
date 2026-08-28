import type { DataSource } from "typeorm";
import { cutoff, type RetentionPeriods, type RetentionRule } from "./retention.policy.js";

/** What one sweep did. */
export interface SweptResult {
  readonly removed: number;
  /**
   * Whether everything past its period has been dealt with.
   *
   * Distinct from having removed nothing: a sweep that filled its batch has
   * almost certainly left more behind and should run again at once.
   */
  readonly reachedEnd: boolean;
}

/** An upload past its registration window, with what is needed to erase it. */
export interface ExpiredUpload {
  readonly uploadId: string;
  readonly ownerUserId: string;
}

/**
 * Removing what has aged out.
 *
 * Every sweep here follows `sweepPublishedOutbox` rather than the
 * claim-lease-retry shape the queue-driven workers use, and the difference is
 * the point: a sweep has no per-row state, no lease, and no attempt count,
 * because one that fails simply runs again on the next pass. Bounded batches
 * with `FOR UPDATE SKIP LOCKED`, a count returned, and nothing remembered.
 */
export class RetentionRepository {
  /**
   * Build the retention repository.
   *
   * @param dataSource - Sweeps run outside a caller's transaction: each is its
   *   own bounded unit, and holding one transaction across all of them would
   *   lock rows the application is using for as long as the slowest takes.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Apply one rule.
   *
   * @param rule - What to sweep, judged by which timestamp, matching which
   *   rows.
   * @param periods - How long each category is kept.
   * @param batchSize - How many rows at most.
   * @param now - The instant to measure ages from.
   * @returns How many rows it affected, and whether more remain.
   * @throws {RangeError} If the configured period is negative, which would put
   *   the cutoff in the future and sweep rows that have not aged at all.
   */
  async apply(
    rule: RetentionRule,
    periods: RetentionPeriods,
    batchSize: number,
    now: Date = new Date(),
  ): Promise<SweptResult> {
    const before = cutoff(now, periods[rule.period]);

    // Table, column and predicate come from the schedule in this feature and
    // never from a caller, which is what makes interpolating them safe. The
    // cutoff — the only value that varies at run time — is a parameter.
    //
    // Selected then acted on, rather than acted on directly, so the batch is
    // bounded: an unbounded `DELETE` on a table nobody has swept for a year
    // would hold locks for as long as it took.
    // `AS MATERIALIZED` is load-bearing, not decoration.
    //
    // Without it the planner may inline the subquery into the `IN` and evaluate
    // it more than once, applying `LIMIT` afresh each time — so a sweep with a
    // batch of two removed five. It reproduced about once in four runs, which
    // is exactly often enough to be dismissed as a flaky test. Materialising
    // forces one evaluation, and `FOR UPDATE` holds the rows so their `ctid`
    // cannot move underneath the delete.
    //
    // `sweepPublishedOutbox` avoids the question by naming the primary key.
    // That is not available here: the schedule spans tables whose keys differ,
    // and `notification_source_events` has a composite one, so `ctid` is the
    // only identifier every rule can share.
    //
    // The comparison is inclusive. `cutoff` permits a period of zero — "retain
    // nothing" is a configuration this supports — and for that period the
    // cutoff is the instant the sweep began, so an exclusive comparison would
    // keep whatever was written during the millisecond before it. The outbox
    // sweep had exactly this defect and it cost several CI runs before anybody
    // read it as a boundary rather than as a flake.
    const doomed = `SELECT ctid FROM "${rule.table}"
                     WHERE (${rule.where})
                       AND "${rule.column}" IS NOT NULL
                       AND "${rule.column}" <= $1
                     ORDER BY "${rule.column}"
                     LIMIT $2
                       FOR UPDATE SKIP LOCKED`;

    const statement =
      rule.action === "remove"
        ? `WITH doomed AS MATERIALIZED (${doomed}), swept AS (
             DELETE FROM "${rule.table}"
              WHERE ctid IN (SELECT ctid FROM doomed)
             RETURNING 1
           ) SELECT count(*)::int AS removed FROM swept`
        : `WITH doomed AS MATERIALIZED (${doomed}), swept AS (
             UPDATE "${rule.table}"
                SET status = 'invalidated', invalidated_at = $3
              WHERE ctid IN (SELECT ctid FROM doomed)
             RETURNING 1
           ) SELECT count(*)::int AS removed FROM swept`;

    const counted: { removed: number }[] = await this.dataSource.query(
      statement,
      rule.action === "remove" ? [before, batchSize] : [before, batchSize, now],
    );

    const removed = counted[0]?.removed ?? 0;

    return { removed, reachedEnd: removed < batchSize };
  }

  /**
   * Uploads registered and never finished, past the window they were given.
   *
   * @param now - The instant to measure against.
   * @param limit - How many at most.
   * @returns Those to erase, with their owner so the object prefix can be
   *   found. Only registrations that never became usable: an upload a Moment
   *   holds is history, however old the registration was.
   */
  async expiredUploads(now: Date, limit: number): Promise<ExpiredUpload[]> {
    const rows: { upload_id: string; owner_user_id: string }[] = await this.dataSource.query(
      `SELECT upload_id, owner_user_id
         FROM uploads
        WHERE state NOT IN ('ready', 'deleted')
          AND expires_at < $1
        ORDER BY expires_at
        LIMIT $2`,
      [now, limit],
    );

    return rows.map((row) => ({ uploadId: row.upload_id, ownerUserId: row.owner_user_id }));
  }

  /**
   * Remove the rows of uploads whose bytes have already gone.
   *
   * @param now - The instant to measure against.
   * @param retainForDays - How long a deleted row is kept before it goes.
   * @param limit - How many at most.
   * @returns How many were removed, and whether more remain.
   *
   *   An upload any Moment still references is never removed, however old and
   *   however deleted. The foreign key would refuse it, but refusing is not the
   *   same as not attempting: a sweep that threw would abandon the whole batch,
   *   and the Moment it protects might be one awaiting erasure rather than one
   *   in use.
   */
  async sweepDeletedUploads(
    now: Date,
    retainForDays: number,
    limit: number,
  ): Promise<SweptResult> {
    const before = cutoff(now, retainForDays);

    const counted: { removed: number }[] = await this.dataSource.query(
      `WITH swept AS (
         DELETE FROM uploads
          WHERE upload_id IN (
            SELECT upload.upload_id
              FROM uploads upload
             WHERE upload.state = 'deleted'
               AND upload.updated_at < $1
               AND NOT EXISTS (
                     SELECT 1 FROM moment_media media
                      WHERE media.upload_id = upload.upload_id)
             ORDER BY upload.updated_at
             LIMIT $2
               FOR UPDATE SKIP LOCKED
          )
         RETURNING 1
       ) SELECT count(*)::int AS removed FROM swept`,
      [before, limit],
    );

    const removed = counted[0]?.removed ?? 0;

    return { removed, reachedEnd: removed < limit };
  }
}
