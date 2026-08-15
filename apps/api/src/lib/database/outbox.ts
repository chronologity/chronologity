import type pg from "pg";
import type { EventMetadata } from "../../types/domain-event.js";
import { generateId } from "../ids/generate-id.js";
import type { Transaction } from "./transaction.js";

/**
 * The transactional outbox (ADR-016).
 *
 * When PostgreSQL holds the authoritative state, an integration event is
 * written to this table in the same transaction as the state change. Either
 * both land or neither does, which is what removes the dual-write failure:
 *
 *     commit state + outbox   →  publish later, at least once
 *     (never)                    commit state, then fail to publish
 *
 * Publication is deliberately asynchronous. A writer that waited for Kafka
 * would be back to coupling the two systems it just decoupled.
 */

export interface OutboxMessage {
  readonly id: string;
  readonly topic: string;
  readonly partitionKey: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: unknown;
  readonly metadata: EventMetadata;
}

export interface EnqueueOptions {
  readonly topic: string;
  /** Determines ordering. Events that must stay ordered share a key. */
  readonly partitionKey: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: unknown;
  readonly metadata: EventMetadata;
}

/**
 * Write an integration event inside the caller's transaction.
 *
 * Takes a `Transaction`, not a pool, so it is impossible to enqueue outside
 * the transaction the state change belongs to.
 *
 * @param tx - The transaction carrying the state change this event describes.
 *   Taking a transaction rather than a pool makes it impossible to enqueue
 *   outside it.
 * @param options - Topic, partition key, event type and version, payload, and
 *   metadata.
 * @returns The new message's identifier.
 */
export async function enqueueOutboxMessage(
  tx: Transaction,
  options: EnqueueOptions,
): Promise<string> {
  const id = generateId();

  await tx.query(
    `INSERT INTO outbox_messages
       (id, topic, partition_key, event_type, event_version, payload, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      options.topic,
      options.partitionKey,
      options.eventType,
      options.eventVersion,
      JSON.stringify(options.payload),
      JSON.stringify(options.metadata),
    ],
  );

  return id;
}

/**
 * Claim a batch of unpublished messages.
 *
 * `FOR UPDATE SKIP LOCKED` lets several publishers run without processing the
 * same row twice, and without one slow row blocking the queue behind it.
 * Ordering is by creation time so a partition's events keep their sequence.
 *
 * Must be called inside a transaction: the lock lasts only as long as it.
 *
 * @param tx - Must be a transaction: the row locks last only as long as it.
 * @param limit - How many messages to take at most.
 * @returns The claimed messages, oldest first, locked against other publishers
 *   until the transaction ends.
 */
export async function claimOutboxBatch(tx: Transaction, limit: number): Promise<OutboxMessage[]> {
  const { rows } = await tx.query<{
    id: string;
    topic: string;
    partition_key: string;
    event_type: string;
    event_version: number;
    payload: unknown;
    metadata: EventMetadata;
  }>(
    `SELECT id, topic, partition_key, event_type, event_version, payload, metadata
       FROM outbox_messages
      WHERE published_at IS NULL
      ORDER BY created_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit],
  );

  return rows.map((row) => ({
    id: row.id,
    topic: row.topic,
    partitionKey: row.partition_key,
    eventType: row.event_type,
    eventVersion: row.event_version,
    payload: row.payload,
    metadata: row.metadata,
  }));
}

/**
 * Mark messages published. Called after Kafka has acknowledged them.
 *
 * @param tx - The transaction that claimed them.
 * @param ids - Which messages the broker has acknowledged. An empty list is a
 *   no-op.
 * @returns Nothing.
 */
export async function markPublished(tx: Transaction, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  await tx.query(`UPDATE outbox_messages SET published_at = now() WHERE id = ANY($1::uuid[])`, [
    [...ids],
  ]);
}

/**
 * Record a failed publication attempt.
 *
 * The message stays unpublished and will be retried. The attempt count and
 * last error exist so a message failing forever is visible as such, rather
 * than looking like a queue that is merely slow.
 *
 * @param tx - The caller's transaction.
 * @param id - Which message failed.
 * @param error - Why, truncated. The message stays unpublished and will be
 *   retried; the count and reason exist so a message failing forever is visible
 *   as such rather than looking like a slow queue.
 * @returns Nothing.
 */
export async function markFailed(tx: Transaction, id: string, error: string): Promise<void> {
  await tx.query(
    `UPDATE outbox_messages
        SET attempts = attempts + 1,
            last_error = $2
      WHERE id = $1`,
    [id, error.slice(0, 1000)],
  );
}

/**
 * Count unpublished messages. Publication backlog is an operational signal.
 *
 * @param pool - Read-only use.
 * @returns How many messages are waiting. Publication backlog is an operational
 *   signal.
 */
export async function countPending(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM outbox_messages WHERE published_at IS NULL`,
  );

  return Number(rows[0]?.count ?? "0");
}
