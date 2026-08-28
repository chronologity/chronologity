import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { createEventConsumer, type ConsumedEvent } from "../lib/messaging/consumer.js";
import { createMessaging, type Messaging } from "../lib/messaging/kafka.js";
import { createEventProducer } from "../lib/messaging/producer.js";
import { topicName } from "../lib/messaging/topics.js";
import { publishOutboxBatch } from "../workers/outbox-publisher/publish-outbox.js";

/**
 * Driving one change all the way to a worker, through the real broker.
 *
 * Every worker suite otherwise hands events to its handler directly. That
 * proves the handler and says nothing about whether the worker is listening:
 * a topic named wrongly, or a subscription somebody forgot, passes every one of
 * those tests. This is what closes it, and it is shared because three copies of
 * Kafka setup is three places for the setup itself to be wrong.
 *
 * Requires `pnpm infra:up`.
 */

export interface DeliveryOptions {
  readonly dataSource: DataSource;
  /** The boundaries the worker under test subscribes to, as it declares them. */
  readonly boundaries: readonly string[];
  /** Only messages about this aggregate reach the handler. */
  readonly aggregateId: string;
  /** The worker's own handler, unwrapped. */
  readonly handler: (event: ConsumedEvent) => Promise<void>;
  readonly clientId: string;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Publish whatever the outbox holds and wait for the worker to handle it.
 *
 * The consumer group is fresh and reads from the beginning, so a local broker
 * with history redelivers a great deal that is nothing to do with this test.
 * Filtering by aggregate is what keeps that from re-driving unrelated work —
 * the message under test still travels the whole path and still reaches the
 * real handler.
 *
 * @param options - What is being driven, and which worker is listening.
 * @returns How many messages about that aggregate the handler was given, which
 *   is zero when the boundaries are wrong and the message never arrives.
 * @throws {Error} If nothing arrives before the timeout, which is what a
 *   missing or misnamed subscription looks like from here.
 */
export async function deliverThroughBroker(options: DeliveryOptions): Promise<number> {
  const { dataSource, boundaries, aggregateId, handler, clientId } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const messaging = createMessaging({
    brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
    clientId,
  });

  const handled: ConsumedEvent[] = [];

  const consumer = createEventConsumer({
    kafka: messaging.kafka,
    groupId: `${clientId}-${randomUUID()}`,
    topics: boundaries.map((boundary) => topicName(boundary)),
    handler: async (event) => {
      if (event.envelope.aggregate.id !== aggregateId) return;

      await handler(event);
      handled.push(event);
    },
  });

  const producer = createEventProducer(messaging.kafka);

  try {
    await ensureTopics(messaging, dataSource, boundaries);
    await consumer.start();
    await producer.connect();

    // Everything pending, not only this test's message: the publisher claims in
    // creation order across the whole table, so draining is the only way to be
    // sure the message under test has gone.
    let reachedEnd = false;

    while (!reachedEnd) {
      reachedEnd = (await publishOutboxBatch({ dataSource, producer })).reachedEnd;
    }

    const deadline = Date.now() + timeoutMs;

    while (handled.length === 0) {
      if (Date.now() > deadline) {
        throw new Error(
          `Nothing about ${aggregateId} arrived on ${boundaries.join(", ")} within ${timeoutMs}ms`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    return handled.length;
  } finally {
    await consumer.stop();
    await producer.disconnect();
    await messaging.close();
  }
}

/**
 * Create every topic this run could publish to.
 *
 * Auto-creation is disabled on the broker. The boundaries under test are the
 * obvious ones; the rest come from the outbox itself, because the publisher
 * claims across the whole table and one message bound for a topic that does not
 * exist fails the batch carrying the message under test.
 *
 * @param messaging - The client.
 * @param dataSource - Where the pending messages are.
 * @param boundaries - The boundaries under test.
 * @returns Nothing, once every topic exists.
 */
async function ensureTopics(
  messaging: Messaging,
  dataSource: DataSource,
  boundaries: readonly string[],
): Promise<void> {
  const pending: { topic: string }[] = await dataSource.query(
    "SELECT DISTINCT topic FROM outbox_messages WHERE published_at IS NULL",
  );

  const names = new Set([
    ...boundaries.map((boundary) => topicName(boundary)),
    ...pending.map((row) => row.topic),
  ]);

  const admin = messaging.kafka.admin();

  try {
    await admin.connect();
    await admin.createTopics({
      topics: [...names].map((topic) => ({ topic, numPartitions: 1, replicationFactor: 1 })),
      waitForLeaders: true,
    });
  } finally {
    await admin.disconnect();
  }
}
