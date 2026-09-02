import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { EventEnvelope } from "@chronologity/contracts";
import type { Logger } from "../logger/logger.js";
import { createEventConsumer, type ConsumedEvent, type EventConsumer } from "./consumer.js";
import { createMessaging, type Messaging } from "./kafka.js";
import { deadLetterTopic, topicName } from "./topics.js";

/**
 * What the consumer does when a message cannot be processed.
 *
 * The happy path is covered where the outbox is tested. This suite is entirely
 * about failure: a message with no value, one that cannot be decoded, a handler
 * that throws once, and a handler that never stops throwing. Those paths are
 * the consumer's whole reason for existing — delivery is at-least-once and a
 * poison message at the head of a partition blocks everything behind it — and
 * they only ever run when something has already gone wrong, which is when
 * nobody is watching.
 *
 * Real Kafka throughout. What is being tested is partition progress, redelivery
 * and dead-lettering, none of which a stubbed broker exhibits.
 *
 * Requires `pnpm infra:up`. Run with `pnpm test:integration`.
 */

// A distinct topic per run: a shared one would let a fresh consumer group
// replay whatever an earlier run left behind.
const RUN = randomUUID().slice(0, 8);

const envelope = (over: Partial<EventEnvelope> = {}): EventEnvelope => ({
  eventId: randomUUID(),
  eventType: "ThingHappened",
  eventVersion: 1,
  occurredAt: new Date().toISOString(),
  aggregate: { type: "thing", id: randomUUID(), version: 1 },
  payload: { ok: true },
  ...over,
});

const waitFor = async (
  condition: () => boolean,
  what: string,
  timeoutMs = 30_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${what}`);
};

describe("consuming a message that cannot be processed", () => {
  let messaging: Messaging;
  const started: EventConsumer[] = [];

  beforeAll(async () => {
    messaging = createMessaging({
      brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
      clientId: "consumer-failure-integration",
    });
  });

  afterAll(async () => {
    for (const consumer of started) {
      await consumer.stop();
    }
    await messaging.close();
  });

  /** A live topic and its dead-letter topic, both created explicitly. */
  const topics = async (name: string) => {
    const topic = topicName(`${name}-${RUN}`);
    const dlq = deadLetterTopic(topic);

    // Auto-creation is disabled on the broker, so both are explicit. The
    // dead-letter topic in particular must exist before it is needed: a
    // consumer discovering it is missing mid-failure would fail twice.
    const admin = messaging.kafka.admin();
    await admin.connect();
    await admin.createTopics({
      topics: [topic, dlq].map((t) => ({ topic: t, numPartitions: 1, replicationFactor: 1 })),
      waitForLeaders: true,
    });
    await admin.disconnect();

    return { topic, dlq };
  };

  /** Records what was logged at which severity, and nothing else. */
  const recordingLogger = () => {
    const lines: { level: "warn" | "error"; message: string }[] = [];
    const record =
      (level: "warn" | "error") =>
      (_details: unknown, message?: string): void => {
        lines.push({ level, message: message ?? "" });
      };

    return {
      lines,
      logger: { warn: record("warn"), error: record("error"), debug: () => {}, info: () => {} } as
        unknown as Logger,
    };
  };

  /** Start a consumer and register it for shutdown. */
  const consume = async (
    topic: string,
    handler: (event: ConsumedEvent) => Promise<void>,
    maxAttempts?: number,
    logger?: Logger,
  ) => {
    const consumer = createEventConsumer({
      kafka: messaging.kafka,
      groupId: `failure-test-${randomUUID()}`,
      topics: [topic],
      handler,
      ...(maxAttempts === undefined ? {} : { maxAttempts }),
      ...(logger === undefined ? {} : { logger }),
    });

    await consumer.start();
    started.push(consumer);

    return consumer;
  };

  /** Collect whatever lands on a dead-letter topic. */
  const watchDeadLetters = async (dlq: string) => {
    const received: { key: string | undefined; value: string; headers: Record<string, string> }[] =
      [];
    const consumer = messaging.kafka.consumer({ groupId: `dlq-watch-${randomUUID()}` });

    await consumer.connect();
    await consumer.subscribe({ topic: dlq, fromBeginning: true });
    await consumer.run({
      eachMessage: async ({ message }) => {
        received.push({
          key: message.key?.toString(),
          value: message.value?.toString() ?? "",
          headers: Object.fromEntries(
            Object.entries(message.headers ?? {}).map(([k, v]) => [k, v?.toString() ?? ""]),
          ),
        });
      },
    });

    started.push({ start: async () => {}, stop: () => consumer.disconnect() });

    return received;
  };

  /** Publish raw bytes, bypassing the envelope, so malformed input can be sent. */
  const publishRaw = async (topic: string, value: string | null, key?: string) => {
    const producer = messaging.kafka.producer();
    await producer.connect();
    try {
      await producer.send({
        topic,
        messages: [{ ...(key === undefined ? {} : { key }), value }],
      });
    } finally {
      await producer.disconnect();
    }
  };

  it("skips a message with no value and keeps consuming", async () => {
    const { topic } = await topics("novalue");
    const seen: string[] = [];

    await consume(topic, async (event) => {
      seen.push(event.envelope.eventId);
    });

    const good = envelope();
    await publishRaw(topic, null);
    await publishRaw(topic, JSON.stringify(good));

    // The point is not that the empty message is ignored but that the partition
    // keeps moving: a skip that stalled the offset would block everything after
    // it.
    await waitFor(() => seen.includes(good.eventId), "the message after an empty one");
    assert.deepEqual(seen, [good.eventId]);
  });

  it("dead-letters a message that is not JSON, without retrying it", async () => {
    const { topic, dlq } = await topics("notjson");
    const deadLettered = await watchDeadLetters(dlq);
    let handlerCalls = 0;

    await consume(topic, async () => {
      handlerCalls += 1;
    });

    await publishRaw(topic, "this is not json at all", "key-1");

    await waitFor(() => deadLettered.length > 0, "the malformed message to be set aside");

    // No number of retries turns unparseable bytes into a valid message, so it
    // goes straight aside rather than through the retry loop.
    assert.equal(handlerCalls, 0);
    assert.equal(deadLettered[0]?.value, "this is not json at all");
    assert.equal(deadLettered[0]?.key, "key-1");
  });

  it("dead-letters a message that is JSON but not an envelope", async () => {
    const { topic, dlq } = await topics("notenvelope");
    const deadLettered = await watchDeadLetters(dlq);
    let handlerCalls = 0;

    await consume(topic, async () => {
      handlerCalls += 1;
    });

    // Well-formed JSON, wrong shape: the schema is what refuses it, and a
    // handler must never see a message that did not satisfy the contract.
    await publishRaw(topic, JSON.stringify({ eventId: "not-a-uuid", nonsense: true }));

    await waitFor(() => deadLettered.length > 0, "the invalid envelope to be set aside");
    assert.equal(handlerCalls, 0);
  });

  it("keeps the original bytes and records where a dead letter came from", async () => {
    const { topic, dlq } = await topics("evidence");
    const deadLettered = await watchDeadLetters(dlq);

    await consume(topic, async () => {});

    const original = '{"deliberately":"broken"';
    await publishRaw(topic, original);

    await waitFor(() => deadLettered.length > 0, "the dead letter");

    // A poison message is evidence of a defect, so nothing is discarded or
    // rewritten, and it carries where it came from and when it was set aside.
    assert.equal(deadLettered[0]?.value, original);
    assert.equal(deadLettered[0]?.headers["original-topic"], topic);
    assert.match(
      deadLettered[0]?.headers["dead-lettered-at"] ?? "",
      /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/,
    );
  });

  it("retries a handler that fails once, and does not dead-letter it", async () => {
    const { topic, dlq } = await topics("transient");
    const deadLettered = await watchDeadLetters(dlq);
    let attempts = 0;

    await consume(topic, async () => {
      attempts += 1;

      if (attempts === 1) {
        throw new Error("dependency briefly unavailable");
      }
    });

    await publishRaw(topic, JSON.stringify(envelope()));

    await waitFor(() => attempts >= 2, "the retry");

    // Give the consumer room to dead-letter if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    assert.equal(attempts, 2, "a succeeding retry must not be attempted again");
    assert.deepEqual(deadLettered, [], "a message that eventually succeeded was set aside");
  });

  it("gives up after the configured attempts and sets the message aside", async () => {
    const { topic, dlq } = await topics("permanent");
    const deadLettered = await watchDeadLetters(dlq);
    let attempts = 0;

    await consume(
      topic,
      async () => {
        attempts += 1;
        throw new Error("this will never work");
      },
      2,
    );

    const failing = envelope();
    await publishRaw(topic, JSON.stringify(failing));

    await waitFor(() => deadLettered.length > 0, "the exhausted message to be set aside");

    // Retried exactly as configured, then set aside — not retried forever,
    // which would block every message behind it in the partition.
    assert.equal(attempts, 2);
    assert.equal(JSON.parse(deadLettered[0]?.value ?? "{}").eventId, failing.eventId);
  });

  it("keys a dead-lettered message by its aggregate, so its failures stay together", async () => {
    const { topic, dlq } = await topics("dlqkey");
    const deadLettered = await watchDeadLetters(dlq);
    const aggregateId = randomUUID();

    await consume(
      topic,
      async () => {
        throw new Error("nope");
      },
      1,
    );

    await publishRaw(
      topic,
      JSON.stringify(envelope({ aggregate: { type: "thing", id: aggregateId, version: 1 } })),
    );

    await waitFor(() => deadLettered.length > 0, "the dead letter");
    assert.equal(deadLettered[0]?.key, aggregateId);
  });

    it("warns while it will still retry, and errors only when it gives up", async () => {
      const { topic, dlq } = await topics("severity");
      await watchDeadLetters(dlq);
      const { lines, logger } = recordingLogger();

      await consume(
        topic,
        async () => {
          throw new Error("nope");
        },
        3,
        logger,
      );

      await publishRaw(topic, JSON.stringify(envelope()));

      await waitFor(
        () => lines.some((line) => line.level === "error"),
        "the give-up log line",
      );

      // Severity is the operational contract: a retry that will probably
      // succeed must not page anyone, and giving up must.
      const retries = lines.filter((line) => line.message === "Handler failed, retrying");
      const gaveUp = lines.filter((line) => line.message === "Handler failed, dead-lettering");

      assert.equal(retries.length, 2);
      assert.ok(retries.every((line) => line.level === "warn"));
      assert.equal(gaveUp.length, 1);
      assert.equal(gaveUp[0]?.level, "error");
    });

  it("keeps consuming after a message has been set aside", async () => {
    const { topic, dlq } = await topics("recovery");
    await watchDeadLetters(dlq);
    const seen: string[] = [];

    await consume(
      topic,
      async (event) => {
        if (event.envelope.eventType === "Poison") {
          throw new Error("nope");
        }

        seen.push(event.envelope.eventId);
      },
      1,
    );

    const good = envelope();
    await publishRaw(topic, JSON.stringify(envelope({ eventType: "Poison" })));
    await publishRaw(topic, JSON.stringify(good));

    // The whole purpose of dead-lettering: one unprocessable message must not
    // stop the partition.
    await waitFor(() => seen.includes(good.eventId), "the message behind a poison one");
  });
});
