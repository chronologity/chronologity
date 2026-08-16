import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { EventMetadata } from "../../types/domain-event.js";
import { createEventStore, type EventStore } from "../eventstore/client.js";
import { ConcurrencyConflictError } from "../eventstore/append-events.js";
import { defineAggregate, type AggregateStore } from "./aggregate.js";

/**
 * Integration tests against a real EventStoreDB.
 *
 * Optimistic concurrency is the one thing that cannot be proven with a fake:
 * a stub returns whatever conflict we program it to return. The exit criteria
 * for this phase require the conflict to come from the database itself.
 *
 * Requires `pnpm infra:up`. Run with `pnpm test:integration`.
 */

const connectionString = process.env.EVENTSTOREDB_URL ?? "esdb://localhost:2113?tls=false";

// A deliberately trivial domain: this phase establishes conventions, and real
// aggregates arrive in Phase 5. A counter is enough to prove replay ordering.
interface CounterState {
  readonly total: number;
  readonly entries: readonly number[];
}

type CounterEvent =
  | { type: "Incremented"; payload: { by: number } }
  | { type: "Reset"; payload: Record<string, never> };

const definition = {
  category: "testcounter",
  initialState: { total: 0, entries: [] } as CounterState,
  evolve(state: CounterState, event: CounterEvent): CounterState {
    switch (event.type) {
      case "Incremented":
        return {
          total: state.total + event.payload.by,
          entries: [...state.entries, event.payload.by],
        };
      case "Reset":
        return { total: 0, entries: [] };
      default:
        return state;
    }
  },
};

const metadata = (): EventMetadata => ({
  traceId: randomUUID(),
  correlationId: undefined,
  causationId: undefined,
  actorUserId: undefined,
  eventVersion: 1,
  recordedAt: new Date().toISOString(),
});

describe("event-sourced aggregate against real EventStoreDB", () => {
  let eventStore: EventStore;
  let store: AggregateStore<CounterState, CounterEvent>;

  beforeAll(async () => {
    eventStore = createEventStore({ connectionString });
    await eventStore.checkHealth();
    store = defineAggregate(definition, eventStore.client);
  });

  afterAll(async () => {
    await eventStore.close();
  });

  it("returns initial state for an aggregate with no history", async () => {
    const loaded = await store.load(randomUUID());

    assert.deepEqual(loaded.state, { total: 0, entries: [] });
    assert.equal(loaded.revision, "no_stream");
    assert.equal(loaded.eventCount, 0);
  });

  it("persists events and reloads the state they imply", async () => {
    const id = randomUUID();

    await store.append(
      id,
      [
        { type: "Incremented", payload: { by: 3 } },
        { type: "Incremented", payload: { by: 4 } },
      ],
      metadata(),
      "no_stream",
    );

    const loaded = await store.load(id);

    assert.equal(loaded.state.total, 7);
    assert.equal(loaded.eventCount, 2);
  });

  it("replays events in the order they were written", async () => {
    const id = randomUUID();

    await store.append(id, [{ type: "Incremented", payload: { by: 1 } }], metadata(), "no_stream");
    let loaded = await store.load(id);

    await store.append(
      id,
      [{ type: "Incremented", payload: { by: 2 } }],
      metadata(),
      loaded.revision,
    );
    loaded = await store.load(id);

    await store.append(
      id,
      [{ type: "Incremented", payload: { by: 3 } }],
      metadata(),
      loaded.revision,
    );
    loaded = await store.load(id);

    // Order is the point: a set would total the same but lose the history.
    assert.deepEqual(loaded.state.entries, [1, 2, 3]);
  });

  it("rejects a second append made against a stale revision", async () => {
    const id = randomUUID();

    await store.append(id, [{ type: "Incremented", payload: { by: 1 } }], metadata(), "no_stream");

    const first = await store.load(id);
    const second = await store.load(id);

    // Both decisions were made against the same revision. The first append
    // moves the stream; the second is now acting on state that no longer holds.
    await store.append(
      id,
      [{ type: "Incremented", payload: { by: 10 } }],
      metadata(),
      first.revision,
    );

    await assert.rejects(
      () =>
        store.append(
          id,
          [{ type: "Incremented", payload: { by: 20 } }],
          metadata(),
          second.revision,
        ),
      (error: unknown) => {
        assert.ok(error instanceof ConcurrencyConflictError);
        assert.equal(error.code, "CONCURRENCY_CONFLICT");
        assert.equal(error.status, 409);
        return true;
      },
    );

    // The losing write left no trace: history reflects the winner only.
    const reloaded = await store.load(id);
    assert.equal(reloaded.state.total, 11);
  });

  it("rejects creating an aggregate that already exists", async () => {
    const id = randomUUID();

    await store.append(id, [{ type: "Incremented", payload: { by: 1 } }], metadata(), "no_stream");

    await assert.rejects(
      () =>
        store.append(id, [{ type: "Incremented", payload: { by: 1 } }], metadata(), "no_stream"),
      ConcurrencyConflictError,
    );
  });

  it("preserves metadata written alongside events", async () => {
    const id = randomUUID();
    const written = metadata();

    await store.append(id, [{ type: "Incremented", payload: { by: 5 } }], written, "no_stream");

    const { readStream } = await import("../eventstore/read-stream.js");
    const { streamName } = await import("../eventstore/stream-name.js");
    const recorded = await readStream(eventStore.client, streamName("testcounter", id));

    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]?.metadata.traceId, written.traceId);
    assert.equal(recorded[0]?.metadata.eventVersion, 1);
  });

  it("replays event types the current code does not recognise", async () => {
    const id = randomUUID();

    // Written by a deployment that knew about an event this build does not.
    await store.append(
      id,
      [
        { type: "Incremented", payload: { by: 2 } },
        { type: "SomethingFromTheFuture", payload: { whatever: true } } as unknown as CounterEvent,
        { type: "Incremented", payload: { by: 3 } },
      ],
      metadata(),
      "no_stream",
    );

    const loaded = await store.load(id);

    // History outlives code: the unknown event is skipped, not fatal.
    assert.equal(loaded.state.total, 5);
    assert.equal(loaded.eventCount, 3);
  });
});
