import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import type { EventEnvelope } from "@chronologity/contracts";
import type { EventMetadata } from "../../types/event-metadata.js";
import { migrate } from "../../lib/database/migrations.js";
import {
  countAbandoned,
  enqueueOutboxMessage,
  sweepPublishedOutbox,
  type MessageSubject,
} from "../../lib/database/outbox.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
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
    await connectDatabase(database);
    messaging = createMessaging({
      brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
      clientId: "outbox-publisher-integration",
    });

    await migrate(database.dataSource);

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
    await database.dataSource.query("DELETE FROM outbox_messages");
    await database.close();
  });

  // The outbox is claimed in creation order across every pending message, not
  // per partition, so each test starts from an empty table rather than
  // inheriting whatever a previous one left behind.
  beforeEach(async () => {
    await database.dataSource.query("DELETE FROM outbox_messages");
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

    await withTransaction(database.dataSource, async (tx) => {
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

    const result = await publishOutboxBatch({ dataSource: database.dataSource, producer });
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
      withTransaction(database.dataSource, async (tx) => {
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

    const result = await publishOutboxBatch({ dataSource: database.dataSource, producer });

    assert.equal(result.published, 0);
    assert.equal(result.reachedEnd, true);
  });

  it("marks published messages so a second pass does not resend them", async () => {
    await withTransaction(database.dataSource, async (tx) => {
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

    const first = await publishOutboxBatch({ dataSource: database.dataSource, producer });
    const second = await publishOutboxBatch({ dataSource: database.dataSource, producer });

    assert.equal(first.published, 3);
    assert.equal(second.published, 0);
  });

  it("reports more work behind a full batch", async () => {
    // A pass that filled its batch should go again immediately rather than
    // sleep, or the queue drains one batch per poll interval.
    await withTransaction(database.dataSource, async (tx) => {
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

    const full = await publishOutboxBatch({ dataSource: database.dataSource, producer, batchSize: 2 });
    const rest = await publishOutboxBatch({ dataSource: database.dataSource, producer, batchSize: 2 });

    assert.equal(full.published, 2);
    assert.equal(full.reachedEnd, false);
    assert.equal(rest.reachedEnd, true);
  });

  it("reports an empty queue as drained", async () => {
    const result = await publishOutboxBatch({ dataSource: database.dataSource, producer });

    assert.equal(result.published, 0);
    assert.equal(result.reachedEnd, true);
  });

  it("leaves a message pending and records why when the broker refuses", async () => {
    const id = await withTransaction(database.dataSource, (tx) =>
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
      dataSource: database.dataSource,
      producer: refusingProducer,
    });

    const rows: {
      published_at: Date | null;
      attempts: number;
      last_error: string | null;
    }[] = await database.dataSource.query("SELECT published_at, attempts, last_error FROM outbox_messages WHERE id = $1", [id]);

    assert.equal(result.published, 0);
    assert.equal(rows[0]?.published_at, null);
    assert.equal(rows[0]?.attempts, 1);
    assert.equal(rows[0]?.last_error, "broker unavailable");
  });

  it("republishes a message the broker refused once it recovers", async () => {
    await withTransaction(database.dataSource, (tx) =>
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

    await publishOutboxBatch({ dataSource: database.dataSource, producer: refusingProducer });
    const recovered = await publishOutboxBatch({ dataSource: database.dataSource, producer });

    assert.equal(recovered.published, 1);
  });

  it("gives two publishers disjoint work", async () => {
    // `FOR UPDATE SKIP LOCKED` is what allows more than one instance to run.
    // The previous publisher read a single shared checkpoint and could not.
    await withTransaction(database.dataSource, async (tx) => {
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
      publishOutboxBatch({ dataSource: database.dataSource, producer, batchSize: 3 }),
      publishOutboxBatch({ dataSource: database.dataSource, producer, batchSize: 3 }),
    ]);

    const rows: { count: string }[] = await database.dataSource.query(
      "SELECT count(*)::text AS count FROM outbox_messages WHERE published_at IS NULL",
    );

    assert.equal(left.published + right.published, 6);
    assert.equal(rows[0]?.count, "0");
  });

  describe("a message the broker will never accept", () => {
    it("is set aside once it has failed enough times", async () => {
      const aggregateId = randomUUID();

      await withTransaction(database.dataSource, async (tx) => {
        await enqueueOutboxMessage(tx, {
          topic: TOPIC,
          partitionKey: aggregateId,
          ...subject(aggregateId),
          eventType: "NeverAccepted",
          eventVersion: 1,
          payload: { aggregateId },
          metadata: metadata(),
        });
      });

      // Two attempts tolerated, so the second failure is the one that gives up.
      const first = await publishOutboxBatch({
        dataSource: database.dataSource,
        producer: refusingProducer,
        maximumAttempts: 2,
      });
      assert.equal(first.abandoned, 0, "gave up on the first failure");

      const second = await publishOutboxBatch({
        dataSource: database.dataSource,
        producer: refusingProducer,
        maximumAttempts: 2,
      });
      assert.equal(second.abandoned, 1);

      // Set aside, not deleted: the message and why it failed are both still
      // there for somebody to look at.
      const rows: { abandoned_at: Date | null; last_error: string }[] =
        await database.dataSource.query(
          `SELECT abandoned_at, last_error FROM outbox_messages WHERE aggregate_id = $1`,
          [aggregateId],
        );

      assert.notEqual(rows[0]?.abandoned_at, null);
      assert.match(rows[0]?.last_error ?? "", /broker unavailable/);
      assert.equal(await countAbandoned(database.dataSource), 1);
    });

    it("stops blocking everything queued behind it", async () => {
      const poison = randomUUID();
      const behind = randomUUID();

      // The poison message is enqueued first, so it sorts ahead of the good one
      // and every batch claims it.
      for (const [aggregateId, eventType] of [
        [poison, "NeverAccepted"],
        [behind, "PerfectlyFine"],
      ] as const) {
        await withTransaction(database.dataSource, async (tx) => {
          await enqueueOutboxMessage(tx, {
            topic: TOPIC,
            partitionKey: aggregateId,
            ...subject(aggregateId),
            eventType,
            eventVersion: 1,
            payload: { aggregateId },
            metadata: metadata(),
          });
        });
      }

      // The broker refuses, which fails the whole batch — including the good
      // message, because a batch publishes as one unit. This is the state that
      // used to last forever.
      await publishOutboxBatch({
        dataSource: database.dataSource,
        producer: refusingProducer,
        maximumAttempts: 1,
      });

      assert.equal(await countAbandoned(database.dataSource), 2);

      // Now the broker recovers. Nothing is left to publish, because both were
      // set aside — but the queue is moving again rather than stuck on the
      // first message forever.
      const recovered = await publishOutboxBatch({
        dataSource: database.dataSource,
        producer,
      });

      assert.equal(recovered.published, 0);
      assert.equal(recovered.reachedEnd, true, "the queue is still blocked");
    });

    it("returns to the queue when it is no longer given up on", async () => {
      const aggregateId = randomUUID();

      await withTransaction(database.dataSource, async (tx) => {
        await enqueueOutboxMessage(tx, {
          topic: TOPIC,
          partitionKey: aggregateId,
          ...subject(aggregateId),
          eventType: "FixedLater",
          eventVersion: 1,
          payload: { aggregateId },
          metadata: metadata(),
        });
      });

      await publishOutboxBatch({
        dataSource: database.dataSource,
        producer: refusingProducer,
        maximumAttempts: 1,
      });
      assert.equal(await countAbandoned(database.dataSource), 1);

      // What an operator does once the reason it was refused has been fixed.
      await database.dataSource.query(
        `UPDATE outbox_messages SET abandoned_at = NULL WHERE aggregate_id = $1`,
        [aggregateId],
      );

      const result = await publishOutboxBatch({ dataSource: database.dataSource, producer });

      assert.equal(result.published, 1, "clearing abandonment did not requeue it");
      assert.equal(await countAbandoned(database.dataSource), 0);
    });
  });

  describe("retention", () => {
    const HOUR_MS = 60 * 60 * 1_000;

    /** Put a message in the table in whatever state the test needs. */
    const seed = async (state: {
      publishedAgoMs?: number;
      abandonedAgoMs?: number;
    }): Promise<string> => {
      const id = await withTransaction(database.dataSource, (tx) =>
        enqueueOutboxMessage(tx, {
          topic: TOPIC,
          partitionKey: randomUUID(),
          ...subject(),
          eventType: "ThingHappened",
          eventVersion: 1,
          payload: { value: 1 },
          metadata: metadata(),
        }),
      );

      if (state.publishedAgoMs !== undefined) {
        await database.dataSource.query(
          `UPDATE outbox_messages SET published_at = $2 WHERE id = $1`,
          [id, new Date(Date.now() - state.publishedAgoMs)],
        );
      }

      if (state.abandonedAgoMs !== undefined) {
        await database.dataSource.query(
          `UPDATE outbox_messages SET abandoned_at = $2, attempts = 10 WHERE id = $1`,
          [id, new Date(Date.now() - state.abandonedAgoMs)],
        );
      }

      return id;
    };

    const survivors = async (): Promise<string[]> => {
      const rows: { id: string }[] = await database.dataSource.query(
        `SELECT id FROM outbox_messages ORDER BY created_at`,
      );

      return rows.map((row) => row.id);
    };

    it("removes a published message once it is older than the window", async () => {
      await seed({ publishedAgoMs: 4 * HOUR_MS });

      const swept = await sweepPublishedOutbox(database.dataSource, HOUR_MS, 100);

      assert.equal(swept.removed, 1);
      assert.deepEqual(await survivors(), []);
    });

    it("keeps a published message still inside the window", async () => {
      const recent = await seed({ publishedAgoMs: 10 * 60 * 1_000 });

      const swept = await sweepPublishedOutbox(database.dataSource, HOUR_MS, 100);

      assert.equal(swept.removed, 0);
      assert.deepEqual(await survivors(), [recent]);
    });

    it("never removes an unpublished message, however old", async () => {
      const pending = await seed({});
      await database.dataSource.query(
        `UPDATE outbox_messages SET created_at = now() - interval '30 days' WHERE id = $1`,
        [pending],
      );

      const swept = await sweepPublishedOutbox(database.dataSource, 0, 100);

      // Still owed to the broker. Age is not the test; delivery is.
      assert.equal(swept.removed, 0);
      assert.deepEqual(await survivors(), [pending]);
    });

    it("never removes an abandoned message, however old", async () => {
      const abandoned = await seed({ abandonedAgoMs: 30 * 24 * HOUR_MS });

      const swept = await sweepPublishedOutbox(database.dataSource, 0, 100);

      // The only record that something could not be delivered. Sweeping it
      // would destroy the evidence before anybody had looked at why.
      assert.equal(swept.removed, 0);
      assert.deepEqual(await survivors(), [abandoned]);
    });

    it("stops at the batch size and says there is more to do", async () => {
      for (let index = 0; index < 3; index += 1) {
        await seed({ publishedAgoMs: 4 * HOUR_MS });
      }

      const swept = await sweepPublishedOutbox(database.dataSource, HOUR_MS, 2);

      assert.equal(swept.removed, 2);
      assert.equal(swept.reachedEnd, false);
      assert.equal((await survivors()).length, 1);
    });

    it("says it reached the end when there is nothing to remove", async () => {
      const swept = await sweepPublishedOutbox(database.dataSource, HOUR_MS, 100);

      assert.deepEqual(swept, { removed: 0, reachedEnd: true });
    });

    it("sweeps as soon as a message is published when nothing is retained", async () => {
      await seed({ publishedAgoMs: 0 });

      const swept = await sweepPublishedOutbox(database.dataSource, 0, 100);

      assert.equal(swept.removed, 1);
    });

    it("leaves a message the publisher has just delivered", async () => {
      await withTransaction(database.dataSource, (tx) =>
        enqueueOutboxMessage(tx, {
          topic: TOPIC,
          partitionKey: randomUUID(),
          ...subject(),
          eventType: "ThingHappened",
          eventVersion: 1,
          payload: { value: 1 },
          metadata: metadata(),
        }),
      );

      await publishOutboxBatch({ dataSource: database.dataSource, producer });
      const swept = await sweepPublishedOutbox(database.dataSource, HOUR_MS, 100);

      // The window is what makes "did we emit that?" answerable. A sweep that
      // ran behind the publisher would take the answer away immediately.
      assert.equal(swept.removed, 0);
      assert.equal((await survivors()).length, 1);
    });
  });
});
