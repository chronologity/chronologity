import type { ClickHouseClient } from "@clickhouse/client";
import {
  byPartitionBudget,
  contextsNeedingRoom,
  momentsNeedingRoom,
  type StoredContextRow,
  type StoredMomentRow,
} from "./timeline-batch.js";
import type { TimelineScopeRef } from "./timeline.eligibility.js";
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
   * Take a Moment out of *this* projection version.
   *
   * For projection, making room for a corrected row. Deliberately scoped to the
   * version this instance carries: while a second version is being built beside
   * the live one, a writer that deleted across both would destroy the very
   * thing the cutover exists to preserve.
   *
   * **Not the erasure path.** Erasure calls `eraseMomentEverywhere`, which
   * spans versions, because personal history left standing in a version nobody
   * happens to be pointed at is personal history left standing.
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
   * Erase a Moment from every projection version.
   *
   * Unscoped on purpose, and the difference from `remove` is the whole point.
   * A projection version is not a copy that may lag; it is the same derived
   * store built twice, and `privacy.md` requires erasure to reach a derived
   * store rather than leave it to expire. A Moment erased while two versions
   * stood, removed from only the configured one, would come back the moment
   * readers were pointed at the other — and nothing would ever say so.
   *
   * @param momentId - Which Moment.
   * @returns Nothing.
   * @throws {Error} If ClickHouse refuses.
   */
  async eraseMomentEverywhere(momentId: string): Promise<void> {
    await this.client.command({
      query: `DELETE FROM timeline_moments WHERE moment_id = {momentId: String}`,
      query_params: { momentId },
    });
  }

  /**
   * Erase everything an account contributed, from every projection version.
   *
   * @param authorUserId - Whose history.
   * @returns Nothing.
   * @throws {Error} If ClickHouse refuses.
   */
  async eraseEverythingByEverywhere(authorUserId: string): Promise<void> {
    await this.client.command({
      query: `DELETE FROM timeline_moments WHERE author_user_id = {authorUserId: String}`,
      query_params: { authorUserId },
    });
  }

  /**
   * Erase a Moment's scope memberships, from every projection version.
   *
   * @param momentId - Which Moment.
   * @returns Nothing.
   * @throws {Error} If ClickHouse refuses.
   */
  async eraseContextsEverywhere(momentId: string): Promise<void> {
    await this.client.command({
      query: `DELETE FROM timeline_moment_contexts WHERE moment_id = {momentId: String}`,
      query_params: { momentId },
    });
  }

  /**
   * Erase the person rows naming an account, from every projection version.
   *
   * Its own removal because no other one reaches these. A person row for a
   * *participant* carries the Moment's author in `author_user_id` — somebody
   * else — so sweeping by author leaves it standing, and the Moment is not
   * being erased so nothing sweeps by Moment either. What would remain is a row
   * saying this account was part of an experience, which is precisely the
   * record invariants 7 and 8 of `participation.md` forbid outliving them.
   *
   * The relational half is already correct: the account sweep deletes their
   * `moment_participations`. Without this the projection would go on asserting
   * something authoritative state no longer said, and nothing would ever
   * reproject those Moments to correct it.
   *
   * @param userId - Whose rows.
   * @returns Nothing.
   * @throws {Error} If ClickHouse refuses.
   */
  async erasePersonContextsEverywhere(userId: string): Promise<void> {
    await this.client.command({
      query: `DELETE FROM timeline_moment_contexts
               WHERE context_type = 'person' AND context_id = {userId: String}`,
      query_params: { userId },
    });
  }

  /**
   * Erase an account's scope memberships, from every projection version.
   *
   * @param authorUserId - Whose history.
   * @returns Nothing.
   * @throws {Error} If ClickHouse refuses.
   */
  async eraseContextsByEverywhere(authorUserId: string): Promise<void> {
    await this.client.command({
      query: `DELETE FROM timeline_moment_contexts WHERE author_user_id = {authorUserId: String}`,
      query_params: { authorUserId },
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
    contexts: readonly TimelineScopeRef[],
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
   * Record where a page of Moments sits in history, in a handful of statements.
   *
   * The rebuild's path. The live projector keeps writing one Moment at a time,
   * which is right for its shape — a message arrives, a Moment is projected —
   * and wrong for a walk over a whole corpus.
   *
   * Where `project` asks "do you hold this one?" per Moment, and pays a full
   * scan to find out because `moment_id` leads neither table's sort key, this
   * asks once for the whole page. **That question is what made a rebuild
   * quadratic**, and asking it 500 times less often is most of the fix.
   *
   * It also deletes strictly less. A `ReplacingMergeTree` collapses rows sharing
   * a sort key, so only a Moment whose sort key moved needs its old row cleared
   * away; everything else the engine absorbs. The trade is that a rebuild in
   * place now leaves duplicates until a background merge, which is invisible to
   * readers only because `final: 1` is set client-wide — so that setting is
   * load-bearing here in a way it was not before.
   *
   * @param rows - The Moments as the Timeline holds them.
   * @param contextsByMoment - Which scopes each belongs to. A Moment absent from
   *   this writes no context rows.
   * @param projectedAt - Stamped on every row, and taken by the caller **before
   *   it read** the Moments. This is the `ReplacingMergeTree` version column, so
   *   a batch stamped at write time could beat a live projection that had read
   *   fresher state, and the projection would silently revert.
   * @returns Nothing.
   * @throws {Error} If ClickHouse refuses. Retryable: a projection behind is
   *   recoverable, and pretending it succeeded is not.
   */
  async projectBatch(
    rows: readonly TimelineRow[],
    contextsByMoment: ReadonlyMap<string, readonly TimelineScopeRef[]>,
    projectedAt: Date,
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const momentIds = rows.map((row) => row.momentId);
    const goingTo = new Map(rows.map((row) => [row.momentId, row.occurredAt.getTime()]));
    const desiredContexts = new Map(
      rows.map((row) => [
        row.momentId,
        {
          occurredAtMs: row.occurredAt.getTime(),
          contexts: contextsByMoment.get(row.momentId) ?? [],
        },
      ]),
    );

    // Two fixed queries, not one per row — which is the distinction
    // `search.indexer.ts` is drawing when it forbids `Promise.all` over a page.
    // Five hundred concurrent reads exhausted a pool; two do not.
    const [storedMoments, storedContexts] = await Promise.all([
      this.storedMoments(momentIds),
      this.storedContexts(momentIds),
    ]);

    await this.makeRoom(
      "timeline_moments",
      [...momentsNeedingRoom(storedMoments, goingTo)],
    );
    await this.makeRoom(
      "timeline_moment_contexts",
      [...contextsNeedingRoom(storedContexts, desiredContexts)],
    );

    // Split so no single insert spans more partitions than ClickHouse accepts.
    // A page is contiguous in occurrence, so in an ordinary history this is one
    // chunk; a sparse one, or a scoped rebuild naming arbitrary Moments, is why
    // it exists.
    for (const chunk of byPartitionBudget(rows, (row) => row.occurredAt.getUTCFullYear())) {
      await this.client.insert({
        table: "timeline_moments",
        values: chunk.map((row) => toRecord(row, projectedAt, this.version)),
        format: "JSONEachRow",
      });
    }

    const contextRows = rows.flatMap((row) =>
      (contextsByMoment.get(row.momentId) ?? []).map((context) => ({
        context_type: context.type,
        context_id: context.id,
        occurred_at: asClickHouseDateTime(row.occurredAt),
        moment_id: row.momentId,
        author_user_id: row.authorUserId,
        visibility: row.visibility,
        moderation_state: row.moderationState,
        projected_at: asClickHouseDateTime(projectedAt),
        projection_version: this.version,
        occurredAtYear: row.occurredAt.getUTCFullYear(),
      })),
    );

    for (const chunk of byPartitionBudget(contextRows, (row) => row.occurredAtYear)) {
      await this.client.insert({
        table: "timeline_moment_contexts",
        values: chunk.map(({ occurredAtYear: _year, ...value }) => value),
        format: "JSONEachRow",
      });
    }
  }

  /**
   * Take a page of Moments out of this projection version, unconditionally.
   *
   * **Deliberately separate from `projectBatch`, and deliberately asks nothing
   * first.** These identifiers come from finding the Moments gone from the
   * authoritative store; the ones `projectBatch` deletes come from a probe.
   * Merging the two would be correct today and would read as "delete what the
   * probe said" — so the next narrowing of that probe would silently narrow an
   * erasure. `holds` carries the same warning for the same reason.
   *
   * @param momentIds - Which Moments.
   * @returns Nothing.
   * @throws {Error} If ClickHouse refuses.
   */
  async removeBatch(momentIds: readonly string[]): Promise<void> {
    if (momentIds.length === 0) {
      return;
    }

    for (const table of ["timeline_moments", "timeline_moment_contexts"] as const) {
      await this.client.command({
        query: `DELETE FROM ${table}
                 WHERE moment_id IN {momentIds: Array(String)}
                   AND projection_version = {version: String}`,
        query_params: { momentIds: [...momentIds], version: this.version },
      });
    }
  }

  /**
   * Clear stale rows out of a batch's way.
   *
   * @param table - Which table.
   * @param momentIds - Only those a batch decision named. An empty list writes
   *   nothing, which is the ordinary outcome when rebuilding into a fresh
   *   version and is what makes "a rebuild issues no mutations" true rather
   *   than assumed.
   * @returns Nothing.
   * @throws {Error} If ClickHouse refuses.
   */
  private async makeRoom(table: string, momentIds: readonly string[]): Promise<void> {
    if (momentIds.length === 0) {
      return;
    }

    await this.client.command({
      query: `DELETE FROM ${table}
               WHERE moment_id IN {momentIds: Array(String)}
                 AND projection_version = {version: String}`,
      query_params: { momentIds: [...momentIds], version: this.version },
    });
  }

  /**
   * Where a page of Moments is currently stored, if anywhere.
   *
   * @param momentIds - Which Moments.
   * @returns One entry per stored row. A Moment stored at two occurrences —
   *   which a delete missed once already — yields two, and the decision reads
   *   both.
   * @throws {Error} If ClickHouse refuses.
   */
  private async storedMoments(momentIds: readonly string[]): Promise<StoredMomentRow[]> {
    const result = await this.client.query({
      query: `SELECT moment_id, toUnixTimestamp64Milli(occurred_at) AS occurred_at_ms
                FROM timeline_moments
               WHERE moment_id IN {momentIds: Array(String)}
                 AND projection_version = {version: String}`,
      query_params: { momentIds: [...momentIds], version: this.version },
      // A write-path decision rather than a read, and safe without the merge:
      // an unmerged duplicate carries an *equal* occurrence, which changes no
      // answer, while a genuinely stale row carries a different one and must be
      // seen. Skipping it also lets the skip index on `moment_id` do its work.
      clickhouse_settings: { final: 0 },
      format: "JSONEachRow",
    });
    const rows = await result.json<{ moment_id: string; occurred_at_ms: string }>();

    return rows.map((row) => ({
      momentId: row.moment_id,
      occurredAtMs: Number(row.occurred_at_ms),
    }));
  }

  /**
   * Which scopes a page of Moments is currently stored under.
   *
   * Reads the membership, not merely the occurrence. A Moment whose Location was
   * corrected keeps its occurrence and changes its sort key, so a probe that
   * read dates alone would conclude nothing was in the way and leave it showing
   * at both places for ever.
   *
   * @param momentIds - Which Moments.
   * @returns One entry per stored context row.
   * @throws {Error} If ClickHouse refuses.
   */
  private async storedContexts(momentIds: readonly string[]): Promise<StoredContextRow[]> {
    const result = await this.client.query({
      query: `SELECT moment_id, context_type, context_id,
                     toUnixTimestamp64Milli(occurred_at) AS occurred_at_ms
                FROM timeline_moment_contexts
               WHERE moment_id IN {momentIds: Array(String)}
                 AND projection_version = {version: String}`,
      query_params: { momentIds: [...momentIds], version: this.version },
      clickhouse_settings: { final: 0 },
      format: "JSONEachRow",
    });
    const rows = await result.json<{
      moment_id: string;
      context_type: string;
      context_id: string;
      occurred_at_ms: string;
    }>();

    return rows.map((row) => ({
      momentId: row.moment_id,
      contextType: row.context_type,
      contextId: row.context_id,
      occurredAtMs: Number(row.occurred_at_ms),
    }));
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
