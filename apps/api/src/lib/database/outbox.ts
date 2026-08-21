import { IsNull, type DataSource } from "typeorm";
import type { EventMetadata } from "../../types/event-metadata.js";
import { generateId } from "../ids/generate-id.js";
import { OutboxMessage as OutboxRow } from "./outbox.model.js";
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
 *
 * The publisher claims a batch with `FOR UPDATE SKIP LOCKED`, which is the
 * whole mechanism preventing two publishers from sending the same message. It
 * is expressed here as a lock on the query rather than as hand-written SQL,
 * and the driver refuses to take it outside a transaction.
 */

/** The entity a message is about, as the Kafka envelope names it. */
export interface MessageSubject {
  /** The kind of entity, owned by the feature that publishes it. */
  readonly aggregateType: string;
  readonly aggregateId: string;
  /**
   * The entity's version where it carries one for optimistic concurrency, so a
   * consumer can tell an older message from a newer one about the same thing.
   * Zero where it carries none.
   */
  readonly aggregateVersion: number;
}

export interface OutboxMessage extends MessageSubject {
  readonly id: string;
  readonly topic: string;
  readonly partitionKey: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: unknown;
  readonly metadata: EventMetadata;
}

export interface EnqueueOptions extends MessageSubject {
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
 * Takes a transaction, not a client, so it is impossible to enqueue outside the
 * transaction the state change belongs to.
 *
 * @param tx - The transaction carrying the state change this event describes.
 * @param options - Topic, partition key, event type and version, payload,
 *   metadata, and which entity the message is about.
 * @returns The new message's identifier.
 */
export async function enqueueOutboxMessage(
  tx: Transaction,
  options: EnqueueOptions,
): Promise<string> {
  const id = generateId();

  await tx.insert(OutboxRow, {
    id,
    topic: options.topic,
    partitionKey: options.partitionKey,
    eventType: options.eventType,
    eventVersion: options.eventVersion,
    // `jsonb` columns, which the driver serialises. The payload is whatever the
    // publishing service constructed, deliberately not typed here: the envelope
    // is this module's concern and the contents are the feature's.
    payload: options.payload as object,
    metadata: options.metadata,
    aggregateType: options.aggregateType,
    aggregateId: options.aggregateId,
    aggregateVersion: options.aggregateVersion,
    createdAt: new Date(),
    publishedAt: null,
    attempts: 0,
    lastError: null,
  });

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
  // `SKIP LOCKED` is what lets publishers run concurrently: a row another
  // publisher already holds is passed over rather than waited for. Without it
  // they would queue behind each other, or worse, both send the same message.
  const rows = await tx
    .createQueryBuilder(OutboxRow, "message")
    .setLock("pessimistic_write")
    .setOnLocked("skip_locked")
    .where("message.publishedAt IS NULL")
    .orderBy("message.createdAt")
    .limit(limit)
    .getMany();

  return rows.map((row) => ({
    id: row.id,
    topic: row.topic,
    partitionKey: row.partitionKey,
    eventType: row.eventType,
    eventVersion: row.eventVersion,
    payload: row.payload,
    metadata: row.metadata as unknown as EventMetadata,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    aggregateVersion: row.aggregateVersion,
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

  await tx.update(OutboxRow, [...ids], { publishedAt: () => "now()" });
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
  await tx.update(OutboxRow, id, {
    attempts: () => "attempts + 1",
    lastError: error.slice(0, 1000),
  });
}

/**
 * Count unpublished messages. Publication backlog is an operational signal.
 *
 * @param dataSource - Read-only use.
 * @returns How many messages are waiting. Publication backlog is an operational
 *   signal.
 */
export async function countPending(dataSource: DataSource): Promise<number> {
  return dataSource.getRepository(OutboxRow).countBy({ publishedAt: IsNull() });
}
