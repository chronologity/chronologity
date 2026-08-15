import type { EventEnvelope } from "@chronologity/contracts";
import type { EventStoreDBClient } from "@eventstore/db-client";
import type pg from "pg";
import type { EventMetadata } from "../../types/domain-event.js";
import { withTransaction } from "../../lib/database/transaction.js";
import { tryParseStreamName } from "../../lib/eventstore/stream-name.js";
import type { Logger } from "../../lib/logger/logger.js";
import type { EventProducer } from "../../lib/messaging/producer.js";
import { partitionKeyForAggregate, topicName } from "../../lib/messaging/topics.js";

/**
 * The durable bridge from EventStoreDB to Kafka (ADR-015).
 *
 * The two systems share no transaction, so a command handler cannot commit to
 * both. Instead the handler commits to EventStoreDB alone, and this publisher
 * reads committed history and republishes it. Publication is therefore
 * at-least-once, and consumers must be duplicate-safe — which is why the
 * checkpoint advances only after Kafka has acknowledged.
 *
 * The translation is deliberate rather than a passthrough (ADR-014). A domain
 * event is internal aggregate history; an integration event is a boundary
 * contract. Publishing domain events verbatim would let every consumer couple
 * to the write side's internals, and would leak fields that exist in history
 * for reasons no consumer needs.
 */

export interface PublisherOptions {
  readonly client: EventStoreDBClient;
  readonly pool: pg.Pool;
  readonly producer: EventProducer;
  readonly logger?: Logger;
  /** Which stream categories publish, and to which boundary topic. */
  readonly routes: Readonly<Record<string, string>>;
  readonly publisherName?: string;
  readonly maxEvents?: number;
}

export interface PublishResult {
  readonly published: number;
  readonly position: bigint | undefined;
}

const DEFAULT_PUBLISHER_NAME = "eventstore-to-kafka";

async function readPosition(pool: pg.Pool, name: string): Promise<bigint | undefined> {
  const { rows } = await pool.query<{ position: string }>(
    `SELECT position::text FROM publisher_checkpoints WHERE publisher_name = $1`,
    [name],
  );

  const row = rows[0];
  return row === undefined ? undefined : BigInt(row.position);
}

/**
 * Publish everything committed since the last checkpoint.
 *
 * One pass, so the caller decides the cadence and a test can call it directly.
 */
export async function publishPendingEvents({
  client,
  pool,
  producer,
  logger,
  routes,
  publisherName = DEFAULT_PUBLISHER_NAME,
  maxEvents,
}: PublisherOptions): Promise<PublishResult> {
  const fromPosition = await readPosition(pool, publisherName);

  let published = 0;
  let position = fromPosition;

  const stream = client.readAll({
    direction: "forwards",
    fromPosition:
      fromPosition === undefined ? "start" : { commit: fromPosition, prepare: fromPosition },
    ...(maxEvents === undefined ? {} : { maxCount: maxEvents }),
  });

  for await (const resolved of stream) {
    const event = resolved.event;

    if (event === undefined || event.type.startsWith("$") || event.streamId.startsWith("$")) {
      continue;
    }

    const commitPosition = resolved.commitPosition ?? event.position?.commit;

    if (
      commitPosition === undefined ||
      (fromPosition !== undefined && commitPosition <= fromPosition)
    ) {
      continue;
    }

    const parsed = tryParseStreamName(event.streamId);

    // A stream that does not follow the naming convention was written by
    // something else — another tool, a test, or an older convention. Skip it
    // and move on: one unrecognised name must not stop publication for
    // everything behind it.
    if (parsed === undefined) {
      logger?.debug({ streamName: event.streamId }, "Skipping unrecognised stream");
      position = commitPosition;
      await recordPosition(commitPosition);
      continue;
    }

    const { category, aggregateId } = parsed;
    const boundary = routes[category];

    // A category with no route publishes nothing. Publication is opt-in: a new
    // aggregate should not start broadcasting its internal history to every
    // consumer merely because it was created.
    if (boundary === undefined) {
      position = commitPosition;
      await recordPosition(commitPosition);
      continue;
    }

    const metadata = event.metadata as unknown as EventMetadata | undefined;

    const envelope: EventEnvelope = {
      eventId: event.id,
      eventType: event.type,
      eventVersion: metadata?.eventVersion ?? 1,
      occurredAt: metadata?.recordedAt ?? new Date().toISOString(),
      aggregate: {
        type: category,
        id: aggregateId,
        version: Number(event.revision),
      },
      // Correlation travels with the message so a trace survives the hop from
      // a synchronous command into asynchronous processing.
      ...(metadata?.traceId === undefined ? {} : { correlationId: metadata.traceId }),
      ...(metadata?.causationId === undefined ? {} : { causationId: metadata.causationId }),
      ...(metadata?.actorUserId === undefined ? {} : { actor: { userId: metadata.actorUserId } }),
      payload: event.data,
    };

    await producer.publish([
      {
        topic: topicName(boundary),
        partitionKey: partitionKeyForAggregate(aggregateId),
        envelope,
      },
    ]);

    // Only after the broker has acknowledged. Advancing first would turn a
    // publish failure into an event that is silently never published.
    await recordPosition(commitPosition);

    published += 1;
    position = commitPosition;
  }

  logger?.info({ publisher: publisherName, published }, "Publication pass complete");

  return { published, position };

  async function recordPosition(value: bigint): Promise<void> {
    await withTransaction(pool, async (tx) => {
      await tx.query(
        `INSERT INTO publisher_checkpoints (publisher_name, position, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (publisher_name)
         DO UPDATE SET position = EXCLUDED.position, updated_at = now()`,
        [publisherName, value.toString()],
      );
    });
  }
}
