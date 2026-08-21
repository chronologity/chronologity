import type { EventEnvelope } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import {
  claimOutboxBatch,
  markFailed,
  markPublished,
  type OutboxMessage,
} from "../../lib/database/outbox.js";
import { withTransaction } from "../../lib/database/transaction.js";
import type { EventProducer } from "../../lib/messaging/producer.js";
import type { Logger } from "../../lib/logger/logger.js";

/**
 * The durable bridge from PostgreSQL to Kafka (ADR-093).
 *
 * A service that changes state writes its Integration Event to the outbox in
 * the same transaction, so either both land or neither does. This carries what
 * landed to the broker afterwards.
 *
 * It knows nothing about any domain. The row it claims is already the finished
 * message — the service that enqueued it decided what outsiders should be told
 * and wrote it in that shape (ADR-096). There is no route table and nothing to
 * translate.
 *
 * Several instances may run. Rows are claimed with `FOR UPDATE SKIP LOCKED`, so
 * publishers take disjoint batches and a slow row does not block the queue
 * behind it. This is a change from the publisher it replaces, which read a
 * single shared checkpoint and could only ever run once.
 */

export interface PublishOutboxOptions {
  readonly dataSource: DataSource;
  readonly producer: EventProducer;
  /** How many messages to take at once. */
  readonly batchSize?: number;
  /**
   * How many failures to tolerate before setting a message aside.
   *
   * A batch publishes as one unit, so a message the broker permanently refuses
   * fails its whole batch and the batch is re-claimed oldest-first forever.
   * Without a limit the outbox does not retry — it stops.
   */
  readonly maximumAttempts?: number;
  readonly logger?: Logger;
}

export interface PublishOutboxResult {
  readonly published: number;
  /**
   * How many messages this pass gave up on.
   *
   * Above zero means something will never be delivered until somebody looks at
   * why. It is reported rather than logged alone so a caller can act on it.
   */
  readonly abandoned: number;
  /**
   * Whether the queue was drained.
   *
   * Distinct from having published nothing: a pass that published a full batch
   * has almost certainly left more behind and should run again immediately,
   * while a pass that found nothing should wait.
   */
  readonly reachedEnd: boolean;
}

const DEFAULT_BATCH_SIZE = 100;

/**
 * How many failures before a message is set aside.
 *
 * High enough that an ordinary broker outage never reaches it — a publisher
 * retrying every few seconds takes a long while to fail ten times — and low
 * enough that a message which can never be published stops blocking the queue
 * the same day.
 */
const DEFAULT_MAXIMUM_ATTEMPTS = 10;

/**
 * Publish one batch of outbox messages.
 *
 * @param options - Database, producer, batch size, attempt limit, and an
 *   optional logger.
 * @returns How many were published, how many were given up on, and whether the
 *   queue is now empty.
 * @throws {Error} If the database could not be reached. A broker failure is
 *   recorded against the messages and does not throw: the rows stay unpublished
 *   and the next pass tries again, which is what the outbox is for.
 */
export async function publishOutboxBatch(
  options: PublishOutboxOptions,
): Promise<PublishOutboxResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maximumAttempts = options.maximumAttempts ?? DEFAULT_MAXIMUM_ATTEMPTS;

  // Captured inside the transaction so a publish failure can be recorded
  // against the right rows after the transaction has rolled back.
  let claimed: readonly OutboxMessage[] = [];

  try {
    const published: number = await withTransaction(options.dataSource, async (tx) => {
      const messages = await claimOutboxBatch(tx, batchSize);

      if (messages.length === 0) {
        return 0;
      }

      claimed = messages;

      // Sent before the transaction commits, so a crash between the broker's
      // acknowledgement and the commit republishes rather than loses. Delivery
      // is at-least-once and consumers are idempotent; the opposite ordering
      // would be at-most-once, which the outbox exists to avoid.
      await options.producer.publish(
        messages.map((message) => ({
          topic: message.topic,
          partitionKey: message.partitionKey,
          envelope: toEnvelope(message),
        })),
      );

      await markPublished(
        tx,
        messages.map((message) => message.id),
      );

      return messages.length;
    });

    return { published, abandoned: 0, reachedEnd: published < batchSize };
  } catch (error) {
    if (claimed.length === 0) {
      throw error;
    }

    options.logger?.warn(
      { err: error, messages: claimed.length },
      "Outbox batch could not be published",
    );

    // A separate transaction, because the one that claimed these has rolled
    // back and taken any attempt count written inside it with it.
    const abandoned = await withTransaction(options.dataSource, async (tx) => {
      let given = 0;

      for (const message of claimed) {
        if (await markFailed(tx, message.id, describe(error), maximumAttempts)) {
          given += 1;

          // Logged individually and at error level: each one is a message that
          // will never be delivered, and the identifier is what an operator
          // needs to find it.
          options.logger?.error(
            { messageId: message.id, eventType: message.eventType, attempts: maximumAttempts },
            "Outbox message abandoned after repeated failures",
          );
        }
      }

      return given;
    });

    // Not `reachedEnd`, even when everything failed: the next pass has work to
    // do, either retrying these or moving past the ones just set aside.
    return { published: 0, abandoned, reachedEnd: false };
  }
}

/**
 * Shape an outbox row into the envelope every Integration Event travels in.
 *
 * Exported for its own tests. It is the one part of publication that decides
 * anything, and it needs neither a database nor a broker to be wrong.
 *
 * @param message - The claimed row.
 * @returns The envelope. The row's own identifier becomes the event's, so a
 *   message republished after a lost acknowledgement carries the identifier it
 *   carried the first time and a consumer can recognise the duplicate.
 */
export function toEnvelope(message: OutboxMessage): EventEnvelope {
  const { metadata } = message;

  // Falls back to the trace identifier, which is what the request that caused
  // this was known by. Without it the hop into asynchronous processing starts a
  // new trace and the two halves of one action cannot be joined up.
  const correlationId = metadata.correlationId ?? metadata.traceId;

  return {
    eventId: message.id,
    eventType: message.eventType,
    eventVersion: message.eventVersion,
    occurredAt: metadata.recordedAt,
    aggregate: {
      type: message.aggregateType,
      id: message.aggregateId,
      version: message.aggregateVersion,
    },
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(metadata.causationId === undefined ? {} : { causationId: metadata.causationId }),
    ...(metadata.actorUserId === undefined ? {} : { actor: { userId: metadata.actorUserId } }),
    payload: message.payload,
  };
}

/**
 * Describe a failure for the attempt record.
 *
 * @param error - Whatever was thrown.
 * @returns A short description. Stored so a message stuck in the queue can be
 *   diagnosed without reproducing the failure.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
