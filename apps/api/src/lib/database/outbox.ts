import { IsNull, Not, type DataSource } from "typeorm";
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
    abandonedAt: null,
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
    // An abandoned message is no longer pending. Without this the queue stops
    // at the first message the broker will never accept.
    .andWhere("message.abandonedAt IS NULL")
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
 * A message is retried until it has failed `maximumAttempts` times, and is
 * then set aside. That limit is not tidiness: a batch publishes as one unit,
 * so a message the broker permanently refuses fails its whole batch, and the
 * batch is re-claimed oldest-first forever. Without a limit the outbox does
 * not retry — it stops, and nothing behind that message is ever published.
 *
 * @param tx - The caller's transaction.
 * @param id - Which message failed.
 * @param error - Why, truncated.
 * @param maximumAttempts - How many failures to tolerate before giving up.
 * @param at - When it was given up on, if this attempt is the one that does.
 * @returns Whether this attempt is the one that gave up on the message. Until
 *   it does, the message stays unpublished and is retried; once it does, the
 *   message is set aside and everything queued behind it can move.
 */
export async function markFailed(
  tx: Transaction,
  id: string,
  error: string,
  maximumAttempts: number,
  at: Date = new Date(),
): Promise<boolean> {
  // The count and the decision in one statement, so two publishers failing the
  // same message cannot both read the old count and both decide to keep going.
  // `abandoned_at` is set by the statement that takes the attempt past the
  // limit, and by no other.
  const failed = await tx
    .createQueryBuilder()
    .update(OutboxRow)
    .set({
      attempts: () => "attempts + 1",
      lastError: error.slice(0, 1000),
      abandonedAt: () => `CASE WHEN attempts + 1 >= ${Number(maximumAttempts)}
                               THEN :abandonedAt ELSE abandoned_at END`,
    })
    .where("id = :id", { id })
    .setParameter("abandonedAt", at)
    .returning(["abandonedAt"])
    .execute();

  const row = (failed.raw as { abandoned_at: Date | null }[])[0];

  return row?.abandoned_at != null;
}

/**
 * How many messages have been given up on.
 *
 * @param dataSource - Read-only use; no transaction required.
 * @returns The count. Anything above zero is a message that will never be
 *   delivered until somebody looks at why, which is why this is worth
 *   reporting rather than leaving to be discovered.
 */
export async function countAbandoned(dataSource: DataSource): Promise<number> {
  return dataSource.getRepository(OutboxRow).countBy({ abandonedAt: Not(IsNull()) });
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

/** How much of a sweep the caller asked for, and what it found. */
export interface SweepResult {
  /** How many rows were removed. */
  readonly removed: number;
  /**
   * Whether the sweep ran out of work rather than out of batch.
   *
   * A full batch almost certainly leaves more behind and should go again; a
   * short one means there is nothing left to remove for now.
   */
  readonly reachedEnd: boolean;
}

/**
 * Remove published messages that are old enough to be of no further use.
 *
 * The outbox is a queue, not a record. A published row has done its job, and
 * keeping every one forever grows a table nothing reads and holds payloads
 * describing people indefinitely — which the privacy rules do not permit merely
 * because nobody got round to deleting them.
 *
 * A window rather than deleting on publish, because the row is the evidence
 * that an event was emitted at all. When a consumer says it never received
 * something, that is the thing worth looking at, and it is only worth looking
 * at soon after.
 *
 * Three kinds of row are deliberately left alone:
 *
 * - unpublished ones, which are still owed to the broker;
 * - abandoned ones, which are the only record of a message that could not be
 *   delivered and must survive until somebody has looked at why;
 * - published ones inside the window.
 *
 * Concurrent sweepers take disjoint rows through `FOR UPDATE SKIP LOCKED`,
 * the same mechanism that lets several publishers run.
 *
 * @param dataSource - The database to sweep.
 * @param retainForMs - How long a published message is kept, in milliseconds,
 *   measured from when it was published. Zero means keep nothing, and a message
 *   published in the same millisecond the sweep runs is swept: the boundary is
 *   inclusive, because an exclusive one made "retain nothing" untrue for
 *   exactly the messages a zero window is about.
 * @param batchSize - How many rows to remove at most, so a long-neglected table
 *   is drained over several passes rather than in one long-held lock.
 * @param now - Injected so tests can move time without waiting.
 * @returns How many rows were removed, and whether there is more to do.
 */
export async function sweepPublishedOutbox(
  dataSource: DataSource,
  retainForMs: number,
  batchSize: number,
  now: Date = new Date(),
): Promise<SweepResult> {
  const before = new Date(now.getTime() - retainForMs);

  // Counted by the database rather than by the length of what comes back. A
  // `DELETE ... RETURNING` run through the driver yields the rows and the row
  // count together, so measuring the result is measuring the wrong thing — it
  // is two either way.
  //
  // `AS MATERIALIZED` is what makes the batch a batch. Without it the planner
  // may inline the subquery into the `IN` and evaluate it more than once,
  // applying `LIMIT` afresh each time — this swept three messages with a batch
  // of two, having done so latently since it was written and surfaced only when
  // another suite changed the table enough to change the plan. Naming the
  // primary key rather than `ctid` does not help: the hazard is the
  // re-evaluation, not the identifier.
  const counted: { removed: number }[] = await dataSource.query(
    `WITH doomed AS MATERIALIZED (
       SELECT id
         FROM outbox_messages
        WHERE published_at IS NOT NULL
          -- Inclusive. Both timestamps come from the same clock, and with a
          -- retention of zero the cutoff is the instant the sweep began — so an
          -- exclusive comparison cannot remove a message published during the
          -- millisecond before it, and "retain nothing" quietly retained
          -- something. It failed on CI roughly every other run and never here,
          -- because it needs the write and the sweep to land inside one
          -- millisecond, which a fast machine does and a busy laptop does not.
          AND published_at <= $1
        ORDER BY published_at
        LIMIT $2
          FOR UPDATE SKIP LOCKED
     ), swept AS (
       DELETE FROM outbox_messages
        WHERE id IN (SELECT id FROM doomed)
        RETURNING id
     )
     SELECT count(*)::int AS removed FROM swept`,
    [before, batchSize],
  );

  const removed = counted[0]?.removed ?? 0;

  return { removed, reachedEnd: removed < batchSize };
}
