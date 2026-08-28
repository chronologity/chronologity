import type { DataSource } from "typeorm";
import { withTransaction } from "../../lib/database/transaction.js";
import { timelineRowFor } from "./timeline-projection.js";
import type { TimelineRepository } from "./timeline.repository.js";
import type { TimelineSourceRepository } from "./timeline-source.repository.js";

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

    if (row === undefined) {
      // A Moment that has gone, been removed by moderation, or arrived in a
      // state this worker cannot read. Removing rather than leaving what is
      // there: exclusion over retention, and a `remove` for a row that was
      // never written costs one statement and asserts nothing false.
      await this.timeline.remove(momentId);

      return "removed";
    }

    await this.timeline.project(row);

    return "projected";
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
