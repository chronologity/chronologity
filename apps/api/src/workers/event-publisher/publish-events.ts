import type { EventEnvelope } from "@chronologity/contracts";
import type { EventStoreDBClient } from "@eventstore/db-client";
import type pg from "pg";
import type { EventMetadata } from "../../types/event-metadata.js";
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
  /**
   * Which stream categories publish, where to, and how.
   *
   * A route is not merely a destination: it carries the translation from
   * internal history into the boundary contract. A category with no route
   * publishes nothing, so publication stays opt-in.
   */
  readonly routes: Readonly<Record<string, Route>>;
  readonly publisherName?: string;
  readonly maxEvents?: number;
}

/**
 * What a published message looks like for one stream category.
 *
 * The translator is the point. A domain event is internal aggregate history
 * and belongs to the write side; an integration event is a promise to whoever
 * consumes it. Copying one into the other couples every consumer to our
 * internals, and publishes fields that exist in history for reasons no
 * consumer needs — which is what ADR-014 asks us to avoid.
 *
 * Returning undefined publishes nothing, so a category can route some of its
 * event types and stay silent about the rest.
 */
export interface Route {
  readonly boundary: string;
  translate(event: { type: string; payload: unknown }): unknown | undefined;
}

export interface PublishResult {
  readonly published: number;
  readonly position: bigint | undefined;
  /**
   * Whether this pass read to the end of history.
   *
   * "Published nothing" does not mean "caught up": a pass can spend its whole
   * budget on events belonging to categories this publisher does not route.
   * Callers deciding whether to poll again need this rather than the count.
   */
  readonly reachedEnd: boolean;
}

const DEFAULT_PUBLISHER_NAME = "eventstore-to-kafka";

/**
 * Read a publisher's checkpoint.
 *
 * @param pool - Read-only use.
 * @param name - Which publisher.
 * @returns Where it has reached, or undefined if it has never run.
 */
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
 *
 * @param options - The event store, the database holding the checkpoint, the
 *   producer, optional logger, which categories publish and to which boundary,
 *   the publisher's name, and an optional cap on how many events one pass reads.
 * @returns How many events were published, the position reached, and whether the
 *   pass read to the end of history.
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
  // Positions passed over without publishing. Committing one transaction per
  // skipped event makes a pass cost as much as the whole log, and `$all`
  // contains every stream in the database, most of which any given publisher
  // does not route. Recording them once per pass is safe: a crash re-scans
  // events it had already decided not to publish, which costs a little time
  // and changes nothing.
  let unrecordedSkip: bigint | undefined;
  let examined = 0;

  const stream = client.readAll({
    direction: "forwards",
    fromPosition:
      fromPosition === undefined ? "start" : { commit: fromPosition, prepare: fromPosition },
    ...(maxEvents === undefined ? {} : { maxCount: maxEvents }),
  });

  for await (const resolved of stream) {
    examined += 1;
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
      unrecordedSkip = commitPosition;
      continue;
    }

    const { category, aggregateId } = parsed;
    const route = routes[category];

    // A category with no route publishes nothing. Publication is opt-in: a new
    // aggregate should not start broadcasting its internal history to every
    // consumer merely because it was created.
    if (route === undefined) {
      position = commitPosition;
      unrecordedSkip = commitPosition;
      continue;
    }

    const translated = route.translate({ type: event.type, payload: event.data });

    // A routed category may still decline an individual event type. Silence is
    // a deliberate answer, not a gap.
    if (translated === undefined) {
      position = commitPosition;
      unrecordedSkip = commitPosition;
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
      payload: translated,
    };

    await producer.publish([
      {
        topic: topicName(route.boundary),
        partitionKey: partitionKeyForAggregate(aggregateId),
        envelope,
      },
    ]);

    // Only after the broker has acknowledged. Advancing first would turn a
    // publish failure into an event that is silently never published.
    await recordPosition(commitPosition);
    unrecordedSkip = undefined;

    published += 1;
    position = commitPosition;
  }

  // Skipped ground is recorded once, at the end, so the next pass starts past
  // it rather than walking it again.
  if (unrecordedSkip !== undefined) {
    await recordPosition(unrecordedSkip);
  }

  const reachedEnd = maxEvents === undefined || examined < maxEvents;

  logger?.info({ publisher: publisherName, published, reachedEnd }, "Publication pass complete");

  return { published, position, reachedEnd };

  /**
   * Advance the publisher's checkpoint.
   *
   * @param value - The position now safely behind us.
   * @returns Nothing.
   */
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
