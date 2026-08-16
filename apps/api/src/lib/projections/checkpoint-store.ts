import type pg from "pg";
import type { Transaction } from "../database/transaction.js";

/**
 * Projection progress and idempotency.
 *
 * Two facts are recorded per projection: how far it has read, and which events
 * it has already applied. They answer different questions. The checkpoint says
 * where to resume; the processed-event record says whether this specific event
 * has been seen before, which matters because at-least-once delivery can
 * redeliver an event the checkpoint has already passed.
 *
 * Both live in the projection's own database so they can be updated in the same
 * transaction as the read model itself. A checkpoint that commits separately
 * from the state it describes is a checkpoint that will eventually lie.
 */

export interface Checkpoint {
  readonly projectionName: string;
  readonly source: string;
  readonly position: bigint;
}

/**
 * Read a projection's position. Absent means it has never run.
 *
 * @param pool - Read-only use.
 * @param projectionName - Carries the projection's version, so a rebuilt version
 *   tracks its own progress beside the one still serving reads.
 * @returns Where the projection has reached, or undefined if it has never run.
 */
export async function readCheckpoint(
  pool: pg.Pool,
  projectionName: string,
): Promise<Checkpoint | undefined> {
  const { rows } = await pool.query<{ projection_name: string; source: string; position: string }>(
    `SELECT projection_name, source, position::text
       FROM projection_checkpoints
      WHERE projection_name = $1`,
    [projectionName],
  );

  const row = rows[0];

  if (row === undefined) {
    return undefined;
  }

  return {
    projectionName: row.projection_name,
    source: row.source,
    position: BigInt(row.position),
  };
}

/**
 * Record progress.
 *
 * Takes a transaction so it commits with the read-model changes it describes.
 *
 * @param tx - The transaction carrying the read-model changes this position
 *   describes. A checkpoint that commits separately from the state it describes
 *   is a checkpoint that will eventually lie.
 * @param projectionName - Which projection.
 * @param source - Where the events came from.
 * @param position - How far it has now processed.
 * @returns Nothing.
 */
export async function writeCheckpoint(
  tx: Transaction,
  projectionName: string,
  source: string,
  position: bigint,
): Promise<void> {
  await tx.query(
    `INSERT INTO projection_checkpoints (projection_name, source, position, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (projection_name)
     DO UPDATE SET position = EXCLUDED.position,
                   source = EXCLUDED.source,
                   updated_at = now()`,
    [projectionName, source, position.toString()],
  );
}

/**
 * Claim an event for a projection.
 *
 * Returns false when the event has already been applied. The insert itself is
 * the check, so two workers racing on the same event cannot both win: the
 * primary key decides, not a preceding read that either of them could have
 * made before the other's write.
 *
 * @param tx - The transaction the projection's own effect will commit in.
 * @param projectionName - Which projection is claiming.
 * @param eventId - The event being claimed.
 * @returns Whether this caller won the claim. The insert is the check, so two
 *   workers racing on one event cannot both win: the primary key decides, not a
 *   preceding read either of them could have made first.
 */
export async function claimEvent(
  tx: Transaction,
  projectionName: string,
  eventId: string,
): Promise<boolean> {
  const result = await tx.query(
    `INSERT INTO projection_processed_events (projection_name, event_id)
     VALUES ($1, $2)
     ON CONFLICT (projection_name, event_id) DO NOTHING`,
    [projectionName, eventId],
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Which of these events a projection has already applied.
 *
 * An optimisation, not a safety mechanism: `claimEvent` remains the authority,
 * because only an insert can decide a race. This exists so that a replay over
 * history a projection has already seen — every redelivery, and every rebuild
 * that reaches events it has processed — costs one query per batch instead of
 * one transaction per event.
 *
 * Reading it is safe in the direction that matters. A row is written only in
 * the transaction that applies the event, so "present" always means "applied".
 * The reverse is racy and harmless: an event this reports as unseen still goes
 * through `claimEvent`, which refuses it if another worker got there first.
 *
 * @param pool - Read-only use.
 * @param projectionName - Which projection.
 * @param eventIds - The candidates to check.
 * @returns The subset already applied.
 */
export async function readProcessedEvents(
  pool: pg.Pool,
  projectionName: string,
  eventIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (eventIds.length === 0) {
    return new Set();
  }

  const { rows } = await pool.query<{ event_id: string }>(
    `SELECT event_id FROM projection_processed_events
      WHERE projection_name = $1 AND event_id = ANY($2::uuid[])`,
    [projectionName, eventIds],
  );

  return new Set(rows.map((row) => row.event_id));
}

/**
 * Discard a projection's progress so it can be rebuilt from the beginning.
 *
 * Clears the processed-event record too: a rebuild that remembered what it had
 * already applied would skip the very events it is being rebuilt to reapply.
 *
 * @param tx - The caller's transaction.
 * @param projectionName - Which projection to rewind.
 * @returns Nothing. Clears the processed-event record as well as the checkpoint:
 *   a rebuild that remembered what it had applied would skip the very events it
 *   is being rebuilt to reapply.
 */
export async function resetProjection(tx: Transaction, projectionName: string): Promise<void> {
  await tx.query(`DELETE FROM projection_checkpoints WHERE projection_name = $1`, [projectionName]);
  await tx.query(`DELETE FROM projection_processed_events WHERE projection_name = $1`, [
    projectionName,
  ]);
}
