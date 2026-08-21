import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import type { EventMetadata } from "../../types/event-metadata.js";
import { migrate } from "./migrations.js";
import {
  claimOutboxBatch,
  countPending,
  enqueueOutboxMessage,
  markFailed,
  markPublished,
  type MessageSubject,
} from "./outbox.js";
import { connectDatabase, createDatabase, type Database } from "./postgres.js";
import { withTransaction } from "./transaction.js";

/** Requires `pnpm infra:up`. Run with `pnpm test:integration`. */

const config = {
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? "5432"),
  database: process.env.POSTGRES_DATABASE ?? "chronologity",
  user: process.env.POSTGRES_USER ?? "chronologity",
  password: process.env.POSTGRES_PASSWORD ?? "chronologity",
};

const subject = (aggregateId = randomUUID()): MessageSubject => ({
  aggregateType: "test",
  aggregateId,
  aggregateVersion: 0,
});

const metadata = (traceId = randomUUID()): EventMetadata => ({
  traceId,
  correlationId: undefined,
  causationId: undefined,
  actorUserId: undefined,
  eventVersion: 1,
  recordedAt: new Date().toISOString(),
});

describe("PostgreSQL foundation against a real database", () => {
  let database: Database;

  beforeAll(async () => {
    database = createDatabase(config);
    await connectDatabase(database);
    await database.checkHealth();
    await migrate(database.dataSource);
  });

  afterAll(async () => {
    await database.dataSource.query("DELETE FROM outbox_messages");
    await database.close();
  });

  describe("migrations", () => {
    it("is idempotent: a second run applies nothing", async () => {
      const result = await migrate(database.dataSource);

      assert.equal(result.applied.length, 0);
      assert.ok(result.alreadyApplied > 0);
    });

    it("created the foundational tables", async () => {
      const rows: { table_name: string }[] = await database.dataSource.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' ORDER BY table_name`,
      );
      const tables = rows.map((row) => row.table_name);

      for (const expected of [
        "outbox_messages",
        "projection_processed_events",
        "schema_migrations",
      ]) {
        assert.ok(tables.includes(expected), `expected table ${expected}`);
      }

      // Dropped with the code that wrote them: both recorded a position in an
      // EventStoreDB stream, and there is no such stream to hold one in.
      for (const gone of ["projection_checkpoints", "publisher_checkpoints"]) {
        assert.ok(!tables.includes(gone), `expected table ${gone} to be gone`);
      }
    });
  });

  describe("transactions", () => {
    it("commits work that succeeds", async () => {
      const id = randomUUID();

      await withTransaction(database.dataSource, async (tx) => {
        await enqueueOutboxMessage(tx, {
          topic: "chronologity.test.v1",
          partitionKey: id,
          ...subject(id),
          eventType: "Committed",
          eventVersion: 1,
          payload: { id },
          metadata: metadata(),
        });
      });

      const rows = await database.dataSource.query(
        `SELECT id FROM outbox_messages WHERE partition_key = $1`,
        [id],
      );
      assert.equal(rows.length, 1);
    });

    it("rolls back everything when the work throws", async () => {
      const id = randomUUID();

      await assert.rejects(() =>
        withTransaction(database.dataSource, async (tx) => {
          await enqueueOutboxMessage(tx, {
            topic: "chronologity.test.v1",
            partitionKey: id,
            ...subject(id),
            eventType: "RolledBack",
            eventVersion: 1,
            payload: { id },
            metadata: metadata(),
          });

          throw new Error("domain rejected this");
        }),
      );

      const rows = await database.dataSource.query(
        `SELECT id FROM outbox_messages WHERE partition_key = $1`,
        [id],
      );

      // This is the whole point of the outbox: the message cannot survive a
      // transaction whose state change did not.
      assert.equal(rows.length, 0);
    });

    it("returns the connection to the pool even when work throws", async () => {
      // Twice the pool size. A leaked connection does not fail where it leaks;
      // it exhausts the pool later, somewhere unrelated. So the loop is the
      // assertion: if a failed transaction kept its connection, the eleventh
      // iteration would wait for one that is never coming back and this would
      // fail by timing out rather than by an assertion.
      for (let i = 0; i < 20; i += 1) {
        await assert.rejects(() =>
          withTransaction(database.dataSource, async () => {
            throw new Error("failure");
          }),
        );
      }

      // And the pool is still usable afterwards.
      assert.deepEqual(await database.dataSource.query("SELECT 1 AS ok"), [{ ok: 1 }]);
    });
  });

  describe("outbox", () => {
    // The outbox is FIFO across every pending message, not per partition, so
    // each test starts from an empty table rather than inheriting leftovers.
    beforeEach(async () => {
      await database.dataSource.query("DELETE FROM outbox_messages");
    });

    it("claims, publishes, and marks messages", async () => {
      const key = randomUUID();

      await withTransaction(database.dataSource, async (tx) => {
        for (let i = 0; i < 3; i += 1) {
          await enqueueOutboxMessage(tx, {
            topic: "chronologity.test.v1",
            partitionKey: key,
            ...subject(key),
            eventType: "Enqueued",
            eventVersion: 1,
            payload: { index: i },
            metadata: metadata(),
          });
        }
      });

      const pendingBefore = await countPending(database.dataSource);
      assert.ok(pendingBefore >= 3);

      const claimed = await withTransaction(database.dataSource, async (tx) => {
        const batch = await claimOutboxBatch(tx, 3);
        await markPublished(
          tx,
          batch.map((message) => message.id),
        );
        return batch;
      });

      assert.equal(claimed.length, 3);
      assert.equal(claimed[0]?.metadata.eventVersion, 1);

      const rows: { count: string }[] = await database.dataSource.query(
        `SELECT count(*)::text AS count FROM outbox_messages
          WHERE partition_key = $1 AND published_at IS NULL`,
        [key],
      );
      assert.equal(rows[0]?.count, "0");
    });

    it("preserves creation order within a partition", async () => {
      const key = randomUUID();

      for (const index of [0, 1, 2, 3]) {
        await withTransaction(database.dataSource, async (tx) => {
          await enqueueOutboxMessage(tx, {
            topic: "chronologity.test.v1",
            partitionKey: key,
            ...subject(key),
            eventType: "Ordered",
            eventVersion: 1,
            payload: { index },
            metadata: metadata(),
          });
        });
      }

      const claimed = await withTransaction(database.dataSource, (tx) => claimOutboxBatch(tx, 10));

      assert.deepEqual(
        claimed.map((message) => (message.payload as { index: number }).index),
        [0, 1, 2, 3],
      );
    });

    it("leaves a failed message pending and records why", async () => {
      const id = await withTransaction(database.dataSource, (tx) =>
        enqueueOutboxMessage(tx, {
          topic: "chronologity.test.v1",
          partitionKey: randomUUID(),
          ...subject(),
          eventType: "Failing",
          eventVersion: 1,
          payload: {},
          metadata: metadata(),
        }),
      );

      const abandoned = await withTransaction(database.dataSource, (tx) =>
        markFailed(tx, id, "broker unavailable", 10),
      );

      const rows: { attempts: number; last_error: string }[] = await database.dataSource.query(
        `SELECT attempts, last_error FROM outbox_messages WHERE id = $1`,
        [id],
      );

      assert.equal(rows[0]?.attempts, 1);
      assert.equal(rows[0]?.last_error, "broker unavailable");
      // One failure out of ten is not giving up: it stays claimable.
      assert.equal(abandoned, false);
      assert.equal(await countPending(database.dataSource), 1);
    });

    it("does not hand the same message to two concurrent publishers", async () => {
      await withTransaction(database.dataSource, async (tx) => {
        for (let i = 0; i < 6; i += 1) {
          await enqueueOutboxMessage(tx, {
            topic: "chronologity.test.v1",
            partitionKey: randomUUID(),
            ...subject(),
            eventType: "Contended",
            eventVersion: 1,
            payload: { i },
            metadata: metadata(),
          });
        }
      });

      // SKIP LOCKED is what makes concurrent publishers safe; without it both
      // would block on the same rows or, worse, publish them twice.
      const [first, second] = await Promise.all([
        withTransaction(database.dataSource, async (tx) => {
          const batch = await claimOutboxBatch(tx, 3);
          await new Promise((resolve) => setTimeout(resolve, 50));
          await markPublished(
            tx,
            batch.map((m) => m.id),
          );
          return batch.map((m) => m.id);
        }),
        withTransaction(database.dataSource, async (tx) => {
          const batch = await claimOutboxBatch(tx, 3);
          await markPublished(
            tx,
            batch.map((m) => m.id),
          );
          return batch.map((m) => m.id);
        }),
      ]);

      const overlap = first.filter((id) => second.includes(id));
      assert.deepEqual(overlap, [], "two publishers claimed the same message");
      assert.equal(await countPending(database.dataSource), 0);
    });
  });
});
