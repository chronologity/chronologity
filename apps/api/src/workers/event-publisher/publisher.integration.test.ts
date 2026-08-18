import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { EventMetadata } from "../../types/event-metadata.js";
import type { Projection, ProjectionEvent } from "../../types/projection.js";
import { migrate } from "../../lib/database/migrations.js";
import { createDatabase, type Database } from "../../lib/database/postgres.js";
import { withTransaction } from "../../lib/database/transaction.js";
import { appendEvents } from "../../lib/eventstore/append-events.js";
import { createEventStore, type EventStore } from "../../lib/eventstore/client.js";
import { streamName } from "../../lib/eventstore/stream-name.js";
import { createMessaging, type Messaging } from "../../lib/messaging/kafka.js";
import { createEventProducer, type EventProducer } from "../../lib/messaging/producer.js";
import { createEventConsumer } from "../../lib/messaging/consumer.js";
import { topicName } from "../../lib/messaging/topics.js";
import { writeCheckpoint } from "../../lib/projections/checkpoint-store.js";
import { rebuildProjection, runProjection } from "../../lib/projections/runner.js";
import { publishPendingEvents } from "./publish-events.js";

/**
 * End-to-end asynchronous path: EventStoreDB to Kafka to a consumer, plus the
 * projection foundation reading the same history.
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

// A distinct category and topic per run. Sharing them across runs makes a
// fresh consumer replay every message an earlier run left behind, and sharing
// a category between the two suites below lets one suite's appends land in the
// other's assertions.
const RUN = randomUUID().slice(0, 8);
const CATEGORY = `pubtest${RUN.replace(/-/g, "")}`;
const BOUNDARY = `pubtest-${RUN}`;
const TOPIC = topicName(BOUNDARY);

// Publishes every event it is given, unchanged. These tests are about the
// publisher's own machinery — checkpoints, ordering, delivery — not about any
// feature's choice of what to promise, which each feature states for itself.
const passthrough = { boundary: BOUNDARY, translate: (e: { payload: unknown }) => e.payload };

/** The projection suite writes its own history, so it cannot disturb publication. */
const PROJECTION_CATEGORY = `projtest${RUN.replace(/-/g, "")}`;

const metadata = (traceId: string): EventMetadata => ({
  traceId,
  correlationId: undefined,
  causationId: undefined,
  actorUserId: undefined,
  eventVersion: 1,
  recordedAt: new Date().toISOString(),
});

/**
 * Publish until there is nothing left.
 *
 * Each pass reads a bounded slice of `$all`, and this database accumulates
 * history across the whole test run, so a single pass reaches only as far as
 * its slice. Draining is what makes "published" mean "caught up".
 */
const drain = async (
  run: () => Promise<{ published: number; reachedEnd: boolean }>,
  maxPasses = 200,
): Promise<number> => {
  let total = 0;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const { published, reachedEnd } = await run();
    total += published;
    if (reachedEnd) return total;
  }
  throw new Error("Publisher did not drain");
};

const waitFor = async (condition: () => boolean, timeoutMs = 20_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for condition");
};

describe("asynchronous publication path", () => {
  let database: Database;
  let eventStore: EventStore;
  let messaging: Messaging;
  let producer: EventProducer;

  beforeAll(async () => {
    database = createDatabase(databaseConfig);
    eventStore = createEventStore({
      connectionString: process.env.EVENTSTOREDB_URL ?? "esdb://localhost:2113?tls=false",
    });
    messaging = createMessaging({
      brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
      clientId: "publisher-integration",
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
    await eventStore.close();
    await database.pool.query(`DELETE FROM publisher_checkpoints`);
    await database.pool.query(`DELETE FROM projection_checkpoints`);
    await database.pool.query(`DELETE FROM projection_processed_events`);
    await database.close();
  });

  it("carries a domain event to a Kafka consumer with its trace intact", async () => {
    const aggregateId = randomUUID();
    const traceId = randomUUID();
    const publisherName = `test-${randomUUID()}`;

    await appendEvents({
      client: eventStore.client,
      streamName: streamName(CATEGORY, aggregateId),
      events: [{ type: "ThingHappened", payload: { aggregateId, value: 42 } }],
      metadata: metadata(traceId),
      expectedRevision: "no_stream",
    });

    const received: { eventType: string; correlationId: string | undefined; payload: unknown }[] =
      [];

    const consumer = createEventConsumer({
      kafka: messaging.kafka,
      groupId: `test-consumer-${randomUUID()}`,
      topics: [TOPIC],
      handler: async ({ envelope }) => {
        if ((envelope.payload as { aggregateId?: string }).aggregateId === aggregateId) {
          received.push({
            eventType: envelope.eventType,
            correlationId: envelope.correlationId,
            payload: envelope.payload,
          });
        }
      },
    });

    await consumer.start();

    try {
      const published = await drain(() =>
        publishPendingEvents({
          client: eventStore.client,
          pool: database.pool,
          producer,
          routes: { [CATEGORY]: passthrough },
          publisherName,
          maxEvents: 500,
        }),
      );

      assert.ok(published >= 1);

      await waitFor(() => received.length > 0);

      assert.equal(received[0]?.eventType, "ThingHappened");
      // The trace survives the hop from a synchronous write into asynchronous
      // processing. Without this, an async failure cannot be tied back to the
      // request that caused it.
      assert.equal(received[0]?.correlationId, traceId);
    } finally {
      await consumer.stop();
    }
  });

  it("publishes nothing for a category with no route", async () => {
    const aggregateId = randomUUID();
    const publisherName = `test-${randomUUID()}`;

    await appendEvents({
      client: eventStore.client,
      streamName: streamName("unrouted", aggregateId),
      events: [{ type: "PrivateThing", payload: { secret: true } }],
      metadata: metadata(randomUUID()),
      expectedRevision: "no_stream",
    });

    const result = await publishPendingEvents({
      client: eventStore.client,
      pool: database.pool,
      producer,
      routes: {},
      publisherName,
      maxEvents: 500,
    });

    // Publication is opt-in: a new aggregate does not begin broadcasting its
    // internal history merely because it exists.
    assert.equal(result.published, 0);
  });

  it("resumes from its checkpoint rather than republishing history", async () => {
    const publisherName = `test-${randomUUID()}`;
    const routes = { [CATEGORY]: passthrough };

    await appendEvents({
      client: eventStore.client,
      streamName: streamName(CATEGORY, randomUUID()),
      events: [{ type: "First", payload: {} }],
      metadata: metadata(randomUUID()),
      expectedRevision: "no_stream",
    });

    // Each pass reads a bounded slice, so draining takes as many passes as
    // history requires. Only once drained does "publishes nothing" mean the
    // checkpoint is working rather than that the slice ended.
    const totalPublished = await drain(() =>
      publishPendingEvents({
        client: eventStore.client,
        pool: database.pool,
        producer,
        routes,
        publisherName,
        maxEvents: 500,
      }),
    );

    assert.ok(totalPublished >= 1, "nothing was published while draining");

    const afterDrain = await publishPendingEvents({
      client: eventStore.client,
      pool: database.pool,
      producer,
      routes,
      publisherName,
      maxEvents: 500,
    });

    assert.equal(afterDrain.published, 0, "a further pass republished history");
  });
});

describe("projection foundation", () => {
  let database: Database;
  let eventStore: EventStore;

  beforeAll(async () => {
    database = createDatabase(databaseConfig);
    eventStore = createEventStore({
      connectionString: process.env.EVENTSTOREDB_URL ?? "esdb://localhost:2113?tls=false",
    });
    await migrate(database.pool);
  });

  afterAll(async () => {
    await eventStore.close();
    await database.close();
  });

  /**
   * Where `$all` currently ends.
   *
   * These tests assert behaviour, not scale, but a projection reading `$all`
   * from the start replays every event the local event store has ever held —
   * thousands, after a few runs, at one transaction each. Starting from here
   * means a test sees only the events it appends itself, so its cost stays the
   * same on a developer's tenth run as on a fresh database.
   */
  const currentEnd = async (): Promise<bigint> => {
    let position = 0n;

    // Consumed to the end rather than broken out of. Abandoning a `readAll`
    // leaves its gRPC call open, and closing the client then waits on it —
    // which is a sixty-second hook timeout, not an error anyone would connect
    // to a helper that read one event.
    for await (const resolved of eventStore.client.readAll({
      direction: "backwards",
      fromPosition: "end",
      maxCount: 1,
    })) {
      position = resolved.commitPosition ?? resolved.event?.position?.commit ?? position;
    }

    return position;
  };

  /** Start a projection from a position rather than from the beginning. */
  const startFrom = async (name: string, position: bigint): Promise<void> => {
    await withTransaction(database.pool, (tx) =>
      writeCheckpoint(tx, name, "eventstoredb:$all", position),
    );
  };

  const collectingProjection = (name: string) => {
    const seen: ProjectionEvent[] = [];
    const projection: Projection = {
      name,
      apply: async (event) => {
        seen.push(event);
      },
    };
    return { projection, seen };
  };

  it("applies each event once, even when the same event is delivered again", async () => {
    const name = `proj-${randomUUID()}`;
    const { projection, seen } = collectingProjection(name);
    const start = await currentEnd();
    await startFrom(name, start);

    await appendEvents({
      client: eventStore.client,
      streamName: streamName(PROJECTION_CATEGORY, randomUUID()),
      events: [{ type: "Counted", payload: { n: 1 } }],
      metadata: metadata(randomUUID()),
      expectedRevision: "no_stream",
    });

    await runProjection({ projection, client: eventStore.client, pool: database.pool });
    const afterFirstPass = seen.length;
    assert.equal(afterFirstPass, 1, "the appended event was not applied");

    // Rewind to before this test's own event, forcing its redelivery exactly as
    // an at-least-once source would after a crash between processing and
    // commit. Rewinding to zero would prove the same thing while replaying
    // every event the local store has ever held.
    await startFrom(name, start);

    const replayed = await runProjection({
      projection,
      client: eventStore.client,
      pool: database.pool,
    });

    assert.equal(seen.length, afterFirstPass, "an event was applied twice");
    assert.ok(replayed.skipped > 0, "redelivered events were not recognised as duplicates");
  });

  it("rebuilds from the beginning when its progress is discarded", async () => {
    const name = `proj-${randomUUID()}`;
    const { projection, seen } = collectingProjection(name);

    await appendEvents({
      client: eventStore.client,
      streamName: streamName(PROJECTION_CATEGORY, randomUUID()),
      events: [{ type: "Rebuildable", payload: { n: 1 } }],
      metadata: metadata(randomUUID()),
      expectedRevision: "no_stream",
    });

    // Bounded, and both passes read the same slice. A rebuild discards its
    // checkpoint by definition, so unlike the test above this one cannot start
    // partway through history — but what it asserts is that a rebuild reapplies
    // rather than skips, and that is true of any slice.
    const slice = 25;

    await runProjection({
      projection,
      client: eventStore.client,
      pool: database.pool,
      maxEvents: slice,
    });
    const afterBuild = seen.length;
    assert.ok(afterBuild > 0);

    seen.length = 0;

    // A rebuild must reapply history rather than remember having applied it,
    // or a projection could never be rebuilt after a logic change (ADR-017).
    const result = await rebuildProjection({
      projection,
      client: eventStore.client,
      pool: database.pool,
      maxEvents: slice,
    });

    assert.equal(seen.length, afterBuild);
    assert.equal(result.skipped, 0, "a rebuild skipped events it was meant to reapply");
  });

  it("resumes from its checkpoint on the next pass", async () => {
    const name = `proj-${randomUUID()}`;
    const { projection, seen } = collectingProjection(name);
    await startFrom(name, await currentEnd());

    await appendEvents({
      client: eventStore.client,
      streamName: streamName(PROJECTION_CATEGORY, randomUUID()),
      events: [{ type: "Resumable", payload: { n: 1 } }],
      metadata: metadata(randomUUID()),
      expectedRevision: "no_stream",
    });

    // The first pass must reach the end of history for the second to have
    // nothing to do, which is only affordable if it starts near the end.
    await runProjection({ projection, client: eventStore.client, pool: database.pool });
    const afterFirst = seen.length;
    assert.equal(afterFirst, 1, "the appended event was not applied");

    const second = await runProjection({
      projection,
      client: eventStore.client,
      pool: database.pool,
    });

    assert.equal(seen.length, afterFirst);
    assert.equal(second.applied, 0);
  });
});
