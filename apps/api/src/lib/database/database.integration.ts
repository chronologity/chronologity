import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import type { EventMetadata } from "../../types/domain-event.js";
import { migrate } from "./migrations.js";
import {
  claimOutboxBatch,
  countPending,
  enqueueOutboxMessage,
  markFailed,
  markPublished,
} from "./outbox.js";
import { createDatabase, type Database } from "./postgres.js";
import { withTransaction } from "./transaction.js";

/** Requires `pnpm infra:up`. Run with `pnpm test:integration`. */

const config = {
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? "5432"),
  database: process.env.POSTGRES_DATABASE ?? "chronologity",
  user: process.env.POSTGRES_USER ?? "chronologity",
  password: process.env.POSTGRES_PASSWORD ?? "chronologity",
};

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

  before(async () => {
    database = createDatabase(config);
    await database.checkHealth();
    await migrate(database.pool);
  });

  after(async () => {
    await database.pool.query("DELETE FROM outbox_messages");
    await database.close();
  });

  describe("migrations", () => {
    it("is idempotent: a second run applies nothing", async () => {
      const result = await migrate(database.pool);

      assert.equal(result.applied.length, 0);
      assert.ok(result.alreadyApplied > 0);
    });

    it("created the foundational tables", async () => {
      const { rows } = await database.pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' ORDER BY table_name`,
      );
      const tables = rows.map((row) => row.table_name);

      for (const expected of [
        "outbox_messages",
        "projection_checkpoints",
        "projection_processed_events",
        "publisher_checkpoints",
        "schema_migrations",
      ]) {
        assert.ok(tables.includes(expected), `expected table ${expected}`);
      }
    });
  });

  describe("withTransaction", () => {
    it("commits work that succeeds", async () => {
      const id = randomUUID();

      await withTransaction(database.pool, async (tx) => {
        await enqueueOutboxMessage(tx, {
          topic: "chronologity.test.v1",
          partitionKey: id,
          eventType: "Committed",
          eventVersion: 1,
          payload: { id },
          metadata: metadata(),
        });
      });

      const { rows } = await database.pool.query(
        `SELECT id FROM outbox_messages WHERE partition_key = $1`,
        [id],
      );
      assert.equal(rows.length, 1);
    });

    it("rolls back everything when the work throws", async () => {
      const id = randomUUID();

      await assert.rejects(() =>
        withTransaction(database.pool, async (tx) => {
          await enqueueOutboxMessage(tx, {
            topic: "chronologity.test.v1",
            partitionKey: id,
            eventType: "RolledBack",
            eventVersion: 1,
            payload: { id },
            metadata: metadata(),
          });

          throw new Error("domain rejected this");
        }),
      );

      const { rows } = await database.pool.query(
        `SELECT id FROM outbox_messages WHERE partition_key = $1`,
        [id],
      );

      // This is the whole point of the outbox: the message cannot survive a
      // transaction whose state change did not.
      assert.equal(rows.length, 0);
    });

    it("returns the connection to the pool even when work throws", async () => {
      const before = database.pool.idleCount + database.pool.totalCount;

      for (let i = 0; i < 20; i += 1) {
        await assert.rejects(() =>
          withTransaction(database.pool, async () => {
            throw new Error("failure");
          }),
        );
      }

      // A leaked connection does not fail here; it exhausts the pool later.
      await database.pool.query("SELECT 1");
      assert.ok(database.pool.totalCount <= Math.max(before, 10));
    });
  });

  describe("outbox", () => {
    // The outbox is FIFO across every pending message, not per partition, so
    // each test starts from an empty table rather than inheriting leftovers.
    beforeEach(async () => {
      await database.pool.query("DELETE FROM outbox_messages");
    });

    it("claims, publishes, and marks messages", async () => {
      const key = randomUUID();

      await withTransaction(database.pool, async (tx) => {
        for (let i = 0; i < 3; i += 1) {
          await enqueueOutboxMessage(tx, {
            topic: "chronologity.test.v1",
            partitionKey: key,
            eventType: "Enqueued",
            eventVersion: 1,
            payload: { index: i },
            metadata: metadata(),
          });
        }
      });

      const pendingBefore = await countPending(database.pool);
      assert.ok(pendingBefore >= 3);

      const claimed = await withTransaction(database.pool, async (tx) => {
        const batch = await claimOutboxBatch(tx, 3);
        await markPublished(
          tx,
          batch.map((message) => message.id),
        );
        return batch;
      });

      assert.equal(claimed.length, 3);
      assert.equal(claimed[0]?.metadata.eventVersion, 1);

      const { rows } = await database.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM outbox_messages
          WHERE partition_key = $1 AND published_at IS NULL`,
        [key],
      );
      assert.equal(rows[0]?.count, "0");
    });

    it("preserves creation order within a partition", async () => {
      const key = randomUUID();

      for (const index of [0, 1, 2, 3]) {
        await withTransaction(database.pool, async (tx) => {
          await enqueueOutboxMessage(tx, {
            topic: "chronologity.test.v1",
            partitionKey: key,
            eventType: "Ordered",
            eventVersion: 1,
            payload: { index },
            metadata: metadata(),
          });
        });
      }

      const claimed = await withTransaction(database.pool, (tx) => claimOutboxBatch(tx, 10));

      assert.deepEqual(
        claimed.map((message) => (message.payload as { index: number }).index),
        [0, 1, 2, 3],
      );
    });

    it("leaves a failed message pending and records why", async () => {
      const id = await withTransaction(database.pool, (tx) =>
        enqueueOutboxMessage(tx, {
          topic: "chronologity.test.v1",
          partitionKey: randomUUID(),
          eventType: "Failing",
          eventVersion: 1,
          payload: {},
          metadata: metadata(),
        }),
      );

      await withTransaction(database.pool, (tx) => markFailed(tx, id, "broker unavailable"));

      const { rows } = await database.pool.query<{ attempts: number; last_error: string }>(
        `SELECT attempts, last_error FROM outbox_messages WHERE id = $1`,
        [id],
      );

      assert.equal(rows[0]?.attempts, 1);
      assert.equal(rows[0]?.last_error, "broker unavailable");
      assert.equal(await countPending(database.pool), 1);
    });

    it("does not hand the same message to two concurrent publishers", async () => {
      await withTransaction(database.pool, async (tx) => {
        for (let i = 0; i < 6; i += 1) {
          await enqueueOutboxMessage(tx, {
            topic: "chronologity.test.v1",
            partitionKey: randomUUID(),
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
        withTransaction(database.pool, async (tx) => {
          const batch = await claimOutboxBatch(tx, 3);
          await new Promise((resolve) => setTimeout(resolve, 50));
          await markPublished(
            tx,
            batch.map((m) => m.id),
          );
          return batch.map((m) => m.id);
        }),
        withTransaction(database.pool, async (tx) => {
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
      assert.equal(await countPending(database.pool), 0);
    });
  });
});
