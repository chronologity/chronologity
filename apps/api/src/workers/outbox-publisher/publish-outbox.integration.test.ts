import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import type { EventEnvelope } from "@chronologity/contracts";
import type { EventMetadata } from "../../types/event-metadata.js";
import { migrate } from "../../lib/database/migrations.js";
import { enqueueOutboxMessage, type MessageSubject } from "../../lib/database/outbox.js";
import { createDatabase, type Database } from "../../lib/database/postgres.js";
import { withTransaction } from "../../lib/database/transaction.js";
import { createMessaging, type Messaging } from "../../lib/messaging/kafka.js";
import { createEventConsumer } from "../../lib/messaging/consumer.js";
import { createEventProducer, type EventProducer } from "../../lib/messaging/producer.js";
import { topicName } from "../../lib/messaging/topics.js";
import { publishOutboxBatch } from "./publish-outbox.js";

/**
 * The asynchronous path, end to end: a change committed to PostgreSQL reaching a
 * Kafka consumer through the outbox.
 *
 * The property that matters is the one the previous architecture could not
 * offer — a state change and its announcement either both survive or neither
 * does. It cannot be proven against a stubbed broker or an in-memory database,
 * because what is being tested is that two real systems agree.
 *
 * Requires `pnpm infra:up`. Run with `pnpm test:integration`.
 */

const databaseConfig = {
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? "5432"),
  database: process.env.POSTGRES_DATABASE ?? "chronologity",
  user: process.env.POSTGRES_USER ?? "chronologity",
  password: process.env.POSTGRES_PASSWORD ?? "chronologity",
};

// A distinct topic per run. Sharing one across runs makes a fresh consumer
// replay every message an earlier run left behind.
const RUN = randomUUID().slice(0, 8);
const BOUNDARY = `outboxtest-${RUN}`;
const TOPIC = topicName(BOUNDARY);

const metadata = (over: Partial<EventMetadata> = {}): EventMetadata => ({
  traceId: randomUUID(),
  correlationId: undefined,
  causationId: undefined,
  actorUserId: undefined,
  eventVersion: 1,
  recordedAt: new Date().toISOString(),
  ...over,
});

const subject = (aggregateId = randomUUID()): MessageSubject => ({
  aggregateType: "thing",
  aggregateId,
  aggregateVersion: 0,
});

const waitFor = async (condition: () => boolean, timeoutMs = 20_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for condition");
};

/** A producer that refuses, so a broker failure can be observed. */
const refusingProducer: EventProducer = {
  connect: async () => {},
  disconnect: async () => {},
  publish: async () => {
    throw new Error("broker unavailable");
  },
};

describe("outbox publication against real infrastructure", () => {
  let database: Database;
  let messaging: Messaging;
  let producer: EventProducer;

  beforeAll(async () => {
    database = createDatabase(databaseConfig);
    messaging = createMessaging({
      brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
      clientId: "outbox-publisher-integration",
    });

    await migrate(database.pool);

    // Auto-creation is disabled on the broker, so topics are explicit.
    const admin = messaging.kafka.admin();
    await admin.connect();
    await admin.createTopics({
      topics: [{ topic: TOPIC, numPartitions: 1, replicationFactor: 1 }],
      waitForLeaders: true,
    });
    await admin.disconnect();

    producer = createEventProducer(messaging.kafka);
    await producer.connect();
  });

  afterAll(async () => {
    await producer.disconnect();
    await messaging.close();
    await database.pool.query("DELETE FROM outbox_messages");
    await database.close();
  });

  // The outbox is claimed in creation order across every pending message, not
  // per partition, so each test starts from an empty table rather than
  // inheriting whatever a previous one left behind.
  beforeEach(async () => {
    await database.pool.query("DELETE FROM outbox_messages");
  });

  it("carries a committed change to a Kafka consumer with its trace intact", async () => {
    const aggregateId = randomUUID();
    const traceId = randomUUID();
    const received: EventEnvelope[] = [];

    const consumer = createEventConsumer({
      kafka: messaging.kafka,
      groupId: `outbox-test-${randomUUID()}`,
      topics: [TOPIC],
      handler: async (event) => {
        received.push(event.envelope);
      },
    });
    await consumer.start();

    await withTransaction(database.pool, async (tx) => {
      await enqueueOutboxMessage(tx, {
        topic: TOPIC,
        partitionKey: aggregateId,
        ...subject(aggregateId),
        eventType: "ThingHappened",
        eventVersion: 1,
        payload: { aggregateId, value: 42 },
        metadata: metadata({ traceId }),
      });
    });

    const result = await publishOutboxBatch({ pool: database.pool, producer });
    await waitFor(() => received.length > 0);
    await consumer.stop();

    assert.equal(result.published, 1);
    assert.equal(received[0]?.eventType, "ThingHappened");
    assert.deepEqual(received[0]?.payload, { aggregateId, value: 42 });
    assert.equal(received[0]?.correlationId, traceId);
    assert.equal(received[0]?.aggregate.id, aggregateId);
  });

  it("loses the message when the change it describes is rolled back", async () => {
    // The property the previous architecture could not offer. The announcement
    // and the change share one transaction, so there is no window in which one
    // survives without the other.
    const aggregateId = randomUUID();

    await assert.rejects(() =>
      withTransaction(database.pool, async (tx) => {
        await enqueueOutboxMessage(tx, {
          topic: TOPIC,
          partitionKey: aggregateId,
          ...subject(aggregateId),
          eventType: "NeverHappened",
          eventVersion: 1,
          payload: { aggregateId },
          metadata: metadata(),
        });

        throw new Error("the change was refused");
      }),
    );

    const result = await publishOutboxBatch({ pool: database.pool, producer });

    assert.equal(result.published, 0);
    assert.equal(result.reachedEnd, true);
  });

  it("marks published messages so a second pass does not resend them", async () => {
    await withTransaction(database.pool, async (tx) => {
      for (let index = 0; index < 3; index += 1) {
        await enqueueOutboxMessage(tx, {
          topic: TOPIC,
          partitionKey: randomUUID(),
          ...subject(),
          eventType: "Repeated",
          eventVersion: 1,
          payload: { index },
          metadata: metadata(),
        });
      }
    });

    const first = await publishOutboxBatch({ pool: database.pool, producer });
    const second = await publishOutboxBatch({ pool: database.pool, producer });

    assert.equal(first.published, 3);
    assert.equal(second.published, 0);
  });

  it("reports more work behind a full batch", async () => {
    // A pass that filled its batch should go again immediately rather than
    // sleep, or the queue drains one batch per poll interval.
    await withTransaction(database.pool, async (tx) => {
      for (let index = 0; index < 3; index += 1) {
        await enqueueOutboxMessage(tx, {
          topic: TOPIC,
          partitionKey: randomUUID(),
          ...subject(),
          eventType: "Batched",
          eventVersion: 1,
          payload: { index },
          metadata: metadata(),
        });
      }
    });

    const full = await publishOutboxBatch({ pool: database.pool, producer, batchSize: 2 });
    const rest = await publishOutboxBatch({ pool: database.pool, producer, batchSize: 2 });

    assert.equal(full.published, 2);
    assert.equal(full.reachedEnd, false);
    assert.equal(rest.reachedEnd, true);
  });

  it("reports an empty queue as drained", async () => {
    const result = await publishOutboxBatch({ pool: database.pool, producer });

    assert.equal(result.published, 0);
    assert.equal(result.reachedEnd, true);
  });

  it("leaves a message pending and records why when the broker refuses", async () => {
    const id = await withTransaction(database.pool, (tx) =>
      enqueueOutboxMessage(tx, {
        topic: TOPIC,
        partitionKey: randomUUID(),
        ...subject(),
        eventType: "Unsendable",
        eventVersion: 1,
        payload: {},
        metadata: metadata(),
      }),
    );

    const result = await publishOutboxBatch({
      pool: database.pool,
      producer: refusingProducer,
    });

    const { rows } = await database.pool.query<{
      published_at: Date | null;
      attempts: number;
      last_error: string | null;
    }>("SELECT published_at, attempts, last_error FROM outbox_messages WHERE id = $1", [id]);

    assert.equal(result.published, 0);
    assert.equal(rows[0]?.published_at, null);
    assert.equal(rows[0]?.attempts, 1);
    assert.equal(rows[0]?.last_error, "broker unavailable");
  });

  it("republishes a message the broker refused once it recovers", async () => {
    await withTransaction(database.pool, (tx) =>
      enqueueOutboxMessage(tx, {
        topic: TOPIC,
        partitionKey: randomUUID(),
        ...subject(),
        eventType: "Retried",
        eventVersion: 1,
        payload: {},
        metadata: metadata(),
      }),
    );

    await publishOutboxBatch({ pool: database.pool, producer: refusingProducer });
    const recovered = await publishOutboxBatch({ pool: database.pool, producer });

    assert.equal(recovered.published, 1);
  });

  it("gives two publishers disjoint work", async () => {
    // `FOR UPDATE SKIP LOCKED` is what allows more than one instance to run.
    // The previous publisher read a single shared checkpoint and could not.
    await withTransaction(database.pool, async (tx) => {
      for (let index = 0; index < 6; index += 1) {
        await enqueueOutboxMessage(tx, {
          topic: TOPIC,
          partitionKey: randomUUID(),
          ...subject(),
          eventType: "Shared",
          eventVersion: 1,
          payload: { index },
          metadata: metadata(),
        });
      }
    });

    const [left, right] = await Promise.all([
      publishOutboxBatch({ pool: database.pool, producer, batchSize: 3 }),
      publishOutboxBatch({ pool: database.pool, producer, batchSize: 3 }),
    ]);

    const { rows } = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM outbox_messages WHERE published_at IS NULL",
    );

    assert.equal(left.published + right.published, 6);
    assert.equal(rows[0]?.count, "0");
  });
});
