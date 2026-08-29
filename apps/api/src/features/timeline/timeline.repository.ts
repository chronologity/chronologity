import type { ClickHouseClient } from "@clickhouse/client";
import {
  asClickHouseDateTime,
  TIMELINE_VERSION,
  toRecord,
  type TimelineRecord,
  type TimelineRow,
} from "./timeline-row.js";

/**
 * The Timeline projection, as stored.
 *
 * Every write here removes the Moment's existing row before inserting the new
 * one, and that is not belt-and-braces — it is the correctness of the thing.
 *
 * `ReplacingMergeTree` collapses rows that share its sort key, and the sort key
 * begins with `occurred_at`. Correcting an occurrence changes it, so the engine
 * sees the corrected Moment as a *different* row and keeps both: the Moment
 * appears twice on the Timeline, once where it used to be and once where it
 * belongs. Measured before this was written — a Moment moved from 1998 to 1969
 * came back twice under `FINAL`, and once when the old row was deleted first.
 *
 * Correcting an occurrence is a first-class product capability rather than an
 * unlikely path, so the engine's deduplication is left to do what it is good at
 * — absorbing the same message arriving twice — and the delete handles what it
 * cannot.
 */
export class TimelineRepository {
  /**
   * Build the repository.
   *
   * @param client - The ClickHouse boundary, configured to read with
   *   `final = 1` so a duplicate awaiting a merge never reaches a caller.
   * @param version - Which projection version to read and write. A rebuild
   *   fills a new one beside the live one, and readers cut over when it is
   *   ready.
   * @param now - Injected so a test can pin the version a row is stamped with.
   */
  constructor(
    private readonly client: ClickHouseClient,
    private readonly version: string = TIMELINE_VERSION,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Record where a Moment sits in history.
   *
   * @param row - The Moment as the Timeline holds it.
   * @returns Nothing.
   * @throws {Error} If ClickHouse refuses. The caller treats that as retryable:
   *   a projection behind is a Timeline behind, which is recoverable, and
   *   pretending it succeeded is not.
   */
  async project(row: TimelineRow): Promise<void> {
    if (await this.holds("timeline_moments", row.momentId)) {
      await this.remove(row.momentId);
    }
    await this.client.insert({
      table: "timeline_moments",
      values: [toRecord(row, this.now(), this.version)],
      format: "JSONEachRow",
    });
  }

  /**
   * Take a Moment off the Timeline.
   *
   * Used by projection to make room for a corrected row, and by erasure to make
   * a Moment gone. `privacy.md` requires that derived stores be reachable by
   * erasure rather than left to expire, and this is how this one is reached.
   *
   * @param momentId - Which Moment.
   * @returns Nothing.
   * @throws {Error} If ClickHouse refuses.
   */
  async remove(momentId: string): Promise<void> {
    await this.client.command({
      query: `DELETE FROM timeline_moments WHERE moment_id = {momentId: String} AND projection_version = {version: String}`,
      query_params: { momentId, version: this.version },
    });
  }

  /**
   * Take everything an account contributed off the Timeline.
   *
   * @param authorUserId - Whose history.
   * @returns Nothing.
   * @throws {Error} If ClickHouse refuses.
   */
  async removeEverythingBy(authorUserId: string): Promise<void> {
    await this.client.command({
      query: `DELETE FROM timeline_moments WHERE author_user_id = {authorUserId: String} AND projection_version = {version: String}`,
      query_params: { authorUserId, version: this.version },
    });
  }

  /**
   * Read one Moment's row.
   *
   * @param momentId - Which Moment.
   * @returns The stored record, or undefined when the Timeline does not hold
   *   it. Reads run with `final = 1`, set on the client, so what comes back is
   *   the collapsed row rather than however many parts happen to hold it.
   */
  async find(momentId: string): Promise<TimelineRecord | undefined> {
    const result = await this.client.query({
      query: `SELECT * FROM timeline_moments
               WHERE moment_id = {momentId: String} AND projection_version = {version: String}`,
      query_params: { momentId, version: this.version },
      format: "JSONEachRow",
    });

    return (await result.json<TimelineRecord>())[0];
  }

  /**
   * Read history in the order it happened.
   *
   * The ordering `timeline.md:244` requires, and the reason this table exists.
   * Two Moments sharing an occurrence are separated by their identifier, which
   * is stable and immutable — so the same query returns the same order every
   * time, which is what cursors in 7B will depend on.
   *
   * @param limit - How many at most.
   * @returns Rows oldest first.
   */
  async inOccurrenceOrder(limit: number): Promise<TimelineRecord[]> {
    const result = await this.client.query({
      query: `SELECT * FROM timeline_moments
               WHERE projection_version = {version: String}
               ORDER BY occurred_at ASC, moment_id ASC
               LIMIT {limit: UInt32}`,
      query_params: { version: this.version, limit },
      format: "JSONEachRow",
    });

    return result.json<TimelineRecord>();
  }
  /**
   * Record which scopes a Moment belongs to.
   *
   * Replaces whatever was there, for the same reason `project` does: a Moment
   * whose Location changed would otherwise appear at both places, since
   * `ReplacingMergeTree` keys on the sort tuple and the context is part of it.
   *
   * @param row - The Moment as the Timeline holds it.
   * @param contexts - Every scope it belongs to.
   * @returns Nothing.
   * @throws {Error} If ClickHouse refuses.
   */
  async projectContexts(
    row: TimelineRow,
    contexts: readonly { type: "location" | "real_world_event"; id: string }[],
  ): Promise<void> {
    if (await this.holds("timeline_moment_contexts", row.momentId)) {
      await this.removeContexts(row.momentId);
    }

    if (contexts.length === 0) {
      return;
    }

    const at = this.now();

    await this.client.insert({
      table: "timeline_moment_contexts",
      values: contexts.map((context) => ({
        context_type: context.type,
        context_id: context.id,
        occurred_at: asClickHouseDateTime(row.occurredAt),
        moment_id: row.momentId,
        author_user_id: row.authorUserId,
        visibility: row.visibility,
        moderation_state: row.moderationState,
        projected_at: asClickHouseDateTime(at),
        projection_version: this.version,
      })),
      format: "JSONEachRow",
    });
  }

  /**
   * Take a Moment out of every scope it was in.
   *
   * Called by projection to make room for changed membership, and by erasure:
   * a row saying "this Moment was at this place" is a record that the Moment
   * existed, which is exactly what erasure removes.
   *
   * @param momentId - Which Moment.
   * @returns Nothing.
   * @throws {Error} If ClickHouse refuses.
   */
  async removeContexts(momentId: string): Promise<void> {
    await this.client.command({
      query: `DELETE FROM timeline_moment_contexts
               WHERE moment_id = {momentId: String} AND projection_version = {version: String}`,
      query_params: { momentId, version: this.version },
    });
  }

  /**
   * Take everything an account contributed out of every scope.
   *
   * @param authorUserId - Whose history.
   * @returns Nothing.
   * @throws {Error} If ClickHouse refuses.
   */
  async removeContextsBy(authorUserId: string): Promise<void> {
    await this.client.command({
      query: `DELETE FROM timeline_moment_contexts
               WHERE author_user_id = {authorUserId: String}
                 AND projection_version = {version: String}`,
      query_params: { authorUserId, version: this.version },
    });
  }

  /**
   * Record whether an account's history is withheld.
   *
   * One row per account rather than a flag on every Moment they recorded, which
   * is what makes suspending somebody with a decade of history cost one write
   * instead of ten thousand — and what stops their Timeline being wrong while
   * those writes happened.
   *
   * Rows are written rather than deleted on reinstatement. The newest
   * `decidedAt` wins, so a stale message arriving late cannot resurrect a
   * suspension that was lifted; a delete could not express that.
   *
   * @param userId - Whose account.
   * @param suspended - Whether their history is withheld.
   * @param decidedAt - When the decision was taken, which orders it against any
   *   other decision about the same account.
   * @returns Nothing.
   * @throws {Error} If ClickHouse refuses.
   */
  async recordSuspension(userId: string, suspended: boolean, decidedAt: Date): Promise<void> {
    await this.client.insert({
      table: "timeline_suspended_authors",
      values: [
        {
          user_id: userId,
          decided_at: asClickHouseDateTime(decidedAt),
          suspended: suspended ? 1 : 0,
        },
      ],
      format: "JSONEachRow",
    });
  }

  /**
   * Every account the projection currently withholds.
   *
   * Read by a rebuild so it can reconcile rather than overwrite: an account
   * reinstated while the projection was down needs its row cleared, and one
   * suspended then needs a row written. Without both halves a rebuild could
   * only ever add.
   *
   * `final = 1` because a reinstatement is written as a newer row rather than
   * as a delete — reading the parts unmerged would return an account as both
   * suspended and not.
   *
   * @returns The identifiers of accounts whose newest decision is a suspension.
   * @throws {Error} If ClickHouse refuses.
   */
  async suspendedAuthors(): Promise<string[]> {
    const result = await this.client.query({
      query: `SELECT user_id FROM timeline_suspended_authors
               WHERE suspended = 1 SETTINGS final = 1`,
      format: "JSONEachRow",
    });

    return (await result.json<{ user_id: string }>()).map((row) => row.user_id);
  }

  /**
   * Forget an account entirely.
   *
   * Used by erasure. A row saying somebody was suspended outlives the account
   * it describes, which is a record of a moderation decision about a person who
   * has asked to be forgotten.
   *
   * @param userId - Whose account.
   * @returns Nothing.
   * @throws {Error} If ClickHouse refuses.
   */
  async forgetSuspension(userId: string): Promise<void> {
    await this.client.command({
      query: `DELETE FROM timeline_suspended_authors WHERE user_id = {userId: String}`,
      query_params: { userId },
    });
  }

  /**
   * Whether a table already holds rows for a Moment.
   *
   * Asked before deleting, because a delete in ClickHouse is a mutation and
   * costs one to two seconds whether or not it removes anything — measured
   * against an empty table, so the cost is its bookkeeping rather than any
   * scanning. A read costs a fiftieth of that, and the answer is no almost
   * every time: the first projection of a Moment has nothing to replace.
   *
   * The delete itself stays exactly as it was, and so does what it guarantees.
   * A corrected occurrence or a changed Location writes a row ClickHouse reads
   * as a different Moment rather than a replacement, because both are part of
   * the sort key — so the old row must go, or the Moment appears twice, or at
   * two places at once.
   *
   * Deliberately not used by erasure, which calls `remove` and `removeContexts`
   * directly. There, a probe that missed a row written concurrently would leave
   * personal history behind, and erasure must not depend on a read having been
   * right.
   *
   * @param table - Which projection table to look in.
   * @param momentId - Which Moment.
   * @returns Whether anything is there for this projection version.
   * @throws {Error} If ClickHouse refuses.
   */
  private async holds(
    table: "timeline_moments" | "timeline_moment_contexts",
    momentId: string,
  ): Promise<boolean> {
    const result = await this.client.query({
      query: `SELECT count() AS count FROM ${table}
               WHERE moment_id = {momentId: String} AND projection_version = {version: String}`,
      query_params: { momentId, version: this.version },
      format: "JSONEachRow",
    });
    const rows = await result.json<{ count: string }>();

    return Number(rows[0]?.count ?? 0) > 0;
  }

}
