import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { eventEnvelopeSchema } from "@chronologity/contracts";
import { describe, it } from "vitest";
import type { OutboxMessage } from "../../lib/database/outbox.js";
import { toEnvelope } from "./publish-outbox.js";

/**
 * Turning a stored message into the one that goes on the wire.
 *
 * Worth testing on its own because it is the only part of publication that
 * decides anything, and because what it produces is durable. A message written
 * to a Kafka topic is read back by code that does not exist yet, so a field
 * dropped here is not discovered until something downstream chokes on it —
 * long after the publisher that wrote it.
 */

const message = (over: Partial<OutboxMessage> = {}): OutboxMessage => ({
  id: randomUUID(),
  topic: "chronologity.media.v1",
  partitionKey: randomUUID(),
  eventType: "UploadReceived",
  eventVersion: 1,
  payload: { uploadId: randomUUID() },
  aggregateType: "upload",
  aggregateId: randomUUID(),
  aggregateVersion: 0,
  metadata: {
    traceId: randomUUID(),
    correlationId: undefined,
    causationId: undefined,
    actorUserId: undefined,
    eventVersion: 1,
    recordedAt: "2026-08-18T00:30:00.000Z",
  },
  ...over,
});

describe("toEnvelope", () => {
  it("carries every field a consumer is promised", () => {
    const row = message();

    const envelope = toEnvelope(row);

    assert.equal(envelope.eventType, "UploadReceived");
    assert.equal(envelope.eventVersion, 1);
    assert.equal(envelope.occurredAt, "2026-08-18T00:30:00.000Z");
    assert.deepEqual(envelope.payload, row.payload);
  });

  it("produces something the shared envelope accepts", () => {
    // The producer validates before sending, so a mapping this rejects would
    // fail at publish time rather than here. Catching it here is cheaper.
    assert.doesNotThrow(() => eventEnvelopeSchema.parse(toEnvelope(message())));
  });

  it("makes the stored message's identifier the event's identifier", () => {
    // Delivery is at-least-once, so the same row can be published twice. If the
    // identifier were generated at publish time the two copies would look like
    // different events and an idempotent consumer could not tell them apart.
    const row = message();

    assert.equal(toEnvelope(row).eventId, row.id);
    assert.equal(toEnvelope(row).eventId, toEnvelope(row).eventId);
  });

  it("names the entity the event is about", () => {
    const row = message({ aggregateType: "upload", aggregateVersion: 3 });

    const envelope = toEnvelope(row);

    assert.deepEqual(envelope.aggregate, {
      type: "upload",
      id: row.aggregateId,
      version: 3,
    });
  });

  it("uses the correlation identifier when the message carries one", () => {
    const correlationId = randomUUID();
    const row = message({
      metadata: { ...message().metadata, correlationId },
    });

    assert.equal(toEnvelope(row).correlationId, correlationId);
  });

  it("falls back to the trace identifier when it does not", () => {
    // Without this the hop into asynchronous processing starts a fresh trace,
    // and the request that caused the work cannot be joined to the work.
    const traceId = randomUUID();
    const row = message({
      metadata: { ...message().metadata, traceId, correlationId: undefined },
    });

    assert.equal(toEnvelope(row).correlationId, traceId);
  });

  it("omits absent fields rather than sending them as undefined", () => {
    // `exactOptionalPropertyTypes` distinguishes the two, and so does anything
    // that serialises the envelope: a present key holding undefined survives
    // into JSON as null on some paths and vanishes on others.
    const envelope = toEnvelope(message());

    assert.ok(!("causationId" in envelope));
    assert.ok(!("actor" in envelope));
  });

  it("names the actor when the message records one", () => {
    const actorUserId = randomUUID();
    const row = message({ metadata: { ...message().metadata, actorUserId } });

    assert.deepEqual(toEnvelope(row).actor, { userId: actorUserId });
  });

  it("carries causation when the message records it", () => {
    const causationId = randomUUID();
    const row = message({ metadata: { ...message().metadata, causationId } });

    assert.equal(toEnvelope(row).causationId, causationId);
  });
});
