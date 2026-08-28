import type { ClickHouseClient } from "@clickhouse/client";
import {
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
    await this.remove(row.momentId);
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
}
