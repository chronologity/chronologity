import type { DataSource } from "typeorm";
import { withTransaction } from "../../lib/database/transaction.js";
import { timelineRowFor } from "./timeline-projection.js";
import type { TimelineRepository } from "./timeline.repository.js";
import type {
  TimelineSource,
  TimelineSourceRepository,
} from "./timeline-source.repository.js";
import type { TimelineScopeRef } from "./timeline.eligibility.js";
import type { TimelineRow } from "./timeline-row.js";

/**
 * Keeping the Timeline current.
 *
 * Reads authoritative state and writes the projection. Nothing authoritative
 * depends on it: a Moment is recorded whether or not the Timeline knows yet,
 * and if this is behind by an hour the only consequence is an hour-old
 * Timeline.
 *
 * **Idempotency here is structural rather than transactional**, which is the
 * one place this departs from the Search indexer. That indexer writes its
 * document and its processed-event row in a single PostgreSQL transaction, so
 * the two cannot disagree. No transaction spans PostgreSQL and ClickHouse, so
 * the same trick is unavailable — and rather than invent a two-phase commit
 * between them, the projection is made safe to repeat: every write deletes the
 * Moment's row before inserting, so applying a message twice leaves exactly
 * what applying it once did.
 *
 * `projection_processed_events` is still written, because `projections.md:232`
 * asks for the record and because skipping a message already applied is cheaper
 * than reading PostgreSQL and rewriting ClickHouse to reach the same state. But
 * correctness does not rest on it, which is what makes the missing transaction
 * tolerable rather than a hole.
 */

/** What became of one message. */
export type ProjectionOutcome = "projected" | "removed" | "already-handled";

const PROJECTION_NAME = "timeline";

/**
 * Keeps the Timeline projection current from authoritative state.
 *
 * Reads PostgreSQL, writes ClickHouse, and records which messages it has
 * applied. Safe to run several of: every write replaces the Moment's row
 * rather than adding to it.
 */
export class TimelineProjector {
  /**
   * Build the projector.
   *
   * @param dataSource - PostgreSQL, for reading state and recording progress.
   * @param timeline - The ClickHouse projection.
   * @param source - Authoritative state, read to build each row.
   * @param now - Injected so a test can pin when a message was handled.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly timeline: TimelineRepository,
    private readonly source: TimelineSourceRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Apply one message.
   *
   * @param eventId - The message, so a redelivery can be recognised.
   * @param momentId - Which Moment it concerns.
   * @returns What happened: the row was written, removed, or the message had
   *   already been applied.
   * @throws {Error} If either store refuses.
   */
  async handle(eventId: string, momentId: string): Promise<ProjectionOutcome> {
    if (await this.alreadyHandled(eventId)) {
      return "already-handled";
    }

    const outcome = await this.project(momentId);

    // Recorded after the projection, so a crash in between redelivers and
    // projects again. Projecting again is harmless — the write deletes before
    // it inserts — and skipping is not.
    await withTransaction(this.dataSource, (tx) =>
      tx.query(
        `INSERT INTO projection_processed_events (projection_name, event_id, processed_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (projection_name, event_id) DO NOTHING`,
        [PROJECTION_NAME, eventId, this.now()],
      ),
    );

    return outcome;
  }

  /**
   * Put a Moment where it belongs, or take it off the Timeline.
   *
   * Also the rebuild path, which is why it takes an identifier rather than a
   * message: rebuilding is projecting every Moment with no events involved.
   *
   * @param momentId - Which Moment.
   * @returns Whether the row was written or removed.
   * @throws {Error} If either store refuses.
   */
  async project(momentId: string): Promise<ProjectionOutcome> {
    const source = await this.source.momentFor(momentId);
    const row = source === undefined ? undefined : timelineRowFor(source);

    // Both, so the compiler narrows `source` for the projection below rather
    // than needing an assertion that this branch already guarantees.
    if (source === undefined || row === undefined) {
      // A Moment that has gone, been removed by moderation, or arrived in a
      // state this worker cannot read. Removing rather than leaving what is
      // there: exclusion over retention, and a `remove` for a row that was
      // never written costs one statement and asserts nothing false.
      //
      // Its scope memberships go too. A row saying a withheld Moment was at a
      // place is a record that it exists, which is the disclosure removing the
      // Moment was for.
      await this.timeline.remove(momentId);
      await this.timeline.removeContexts(momentId);

      return "removed";
    }

    await this.timeline.project(row);
    await this.timeline.projectContexts(row, contextsOf(source));

    return "projected";
  }

  /**
   * Project a page of Moments in a handful of statements.
   *
   * The rebuild's path. `project` above stays as it is, because the live worker
   * projects one Moment because one message arrived — the shape is right for
   * it, and wrong for a walk over an entire corpus.
   *
   * @param momentIds - Which Moments, in the order they should be written.
   *   Duplicates are counted once.
   * @returns How many were written and how many taken away, which together
   *   always equal the number of distinct Moments asked for.
   * @throws {Error} If either store refuses. One failing page fails the whole
   *   call: a rebuild will come round again, and a page that half-wrote is a
   *   page whose Moments stay at the head of the walk.
   */
  async projectBatch(momentIds: readonly string[]): Promise<{
    projected: number;
    removed: number;
  }> {
    const wanted = [...new Set(momentIds)];

    // Before the reads, not before the writes. This becomes `projected_at`,
    // which is the column `ReplacingMergeTree` resolves ties on — so a batch
    // stamped after reading could outrank a live projection that had read
    // *fresher* state, and the projection would quietly revert to older truth.
    // `reconcileSuspensions` takes its `startedAt` for the same reason.
    const builtAt = this.now();
    const sources = await this.source.momentsFor(wanted);

    const rows: TimelineRow[] = [];
    const contexts = new Map<string, readonly TimelineScopeRef[]>();
    const gone: string[] = [];

    for (const momentId of wanted) {
      const source = sources.get(momentId);
      const row = source === undefined ? undefined : timelineRowFor(source);

      if (source === undefined || row === undefined) {
        gone.push(momentId);
        continue;
      }

      rows.push(row);
      contexts.set(momentId, contextsOf(source));
    }

    // Unconditional, and its identifiers come from finding the Moments gone
    // from the authoritative store rather than from any probe — the property
    // `remove` carries for the same reason.
    await this.timeline.removeBatch(gone);
    await this.timeline.projectBatch(rows, contexts, builtAt);

    return { projected: rows.length, removed: gone.length };
  }

  /**
   * Record a change to whether an account's history is withheld.
   *
   * Deliberately not a reprojection. Somebody with ten thousand Moments has
   * their eligibility changed by one row here rather than ten thousand writes,
   * and their Timeline is never half-right while those writes happen — which is
   * the arrangement 7A settled and this depends on.
   *
   * @param userId - Whose account.
   * @param status - What it became.
   * @param decidedAt - When, so an out-of-order message cannot resurrect a
   *   suspension that was lifted.
   * @returns Nothing.
   * @throws {Error} If ClickHouse refuses.
   */
  async recordStatus(userId: string, status: string, decidedAt: Date): Promise<void> {
    await this.timeline.recordSuspension(userId, status === "suspended", decidedAt);
  }

  /**
   * Which accounts the projection currently withholds.
   *
   * Read by a rebuild so it can reconcile in both directions rather than only
   * add. Exposed here rather than reaching past the projector to the
   * repository, so a rebuild goes through the same object the worker writes
   * through and cannot drift from it.
   *
   * @returns The identifiers of accounts whose newest decision is a suspension.
   * @throws {Error} If ClickHouse refuses.
   */
  async suspendedAuthors(): Promise<string[]> {
    return this.timeline.suspendedAuthors();
  }

  /**
   * Whether a message has already been applied.
   *
   * @param eventId - The message's identifier.
   * @returns Whether it is recorded as processed.
   */
  private async alreadyHandled(eventId: string): Promise<boolean> {
    const rows: { count: number }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM projection_processed_events
        WHERE projection_name = $1 AND event_id = $2`,
      [PROJECTION_NAME, eventId],
    );

    return (rows[0]?.count ?? 0) > 0;
  }
}

/**
 * Which Timelines a Moment belongs on.
 *
 * Shared by the single-Moment path and the batch, so the two cannot come to
 * disagree about what a Moment's contexts are — which would show as a rebuild
 * quietly rewriting history it should have left alone.
 *
 * @param source - The Moment as the authoritative store holds it.
 * @returns Its scopes: the place, the occasions, and the people.
 */
function contextsOf(source: TimelineSource): readonly TimelineScopeRef[] {
  return [
    ...(source.locationId === undefined
      ? []
      : [{ type: "location" as const, id: source.locationId }]),
    ...source.realWorldEventIds.map((id) => ({ type: "real_world_event" as const, id })),
    // The people whose Timeline this Moment belongs on: whoever recorded it,
    // and whoever has agreed they were there. `timelines.md:176` defines a
    // person's Timeline as exactly that union, and writing both kinds as one
    // context makes it one contiguous range of the sort key rather than a
    // query that reads two tables and merges them.
    //
    // The author's row is not redundant with `timeline_moments.author_user_id`.
    // It is what lets one query answer "this person's history" without knowing
    // in advance which half a row came from.
    { type: "person" as const, id: source.authorUserId },
    ...source.participantUserIds.map((id) => ({ type: "person" as const, id })),
  ];
}
