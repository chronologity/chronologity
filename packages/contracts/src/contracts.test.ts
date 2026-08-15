import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { errorCodeSchema, isRetryable } from "./errors.js";
import { envelopeOf, eventEnvelopeSchema } from "./event-envelope.js";
import { brandedIdentifier, identifierSchema } from "./identifiers.js";
import { occurrenceSchema, timestampSchema } from "./time.js";

const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("identifiers", () => {
  it("accepts UUIDs and rejects anything else", () => {
    assert.equal(identifierSchema.parse(uuid), uuid);
    assert.equal(identifierSchema.safeParse("42").success, false);
    assert.equal(identifierSchema.safeParse("").success, false);
  });
});

describe("timestamps", () => {
  it("requires an explicit offset", () => {
    assert.ok(timestampSchema.safeParse("2026-08-14T10:30:00Z").success);
    assert.ok(timestampSchema.safeParse("2026-08-14T10:30:00+02:00").success);
    assert.equal(
      timestampSchema.safeParse("2026-08-14T10:30:00").success,
      false,
      "a timestamp without a zone cannot be placed in history",
    );
  });
});

describe("occurrence", () => {
  it("carries precision alongside the interval", () => {
    const summer1998 = occurrenceSchema.parse({
      start: "1998-06-01T00:00:00Z",
      end: "1998-08-31T23:59:59Z",
      precision: "month",
    });

    assert.equal(summer1998.precision, "month");
  });

  it("rejects an interval that ends before it starts", () => {
    assert.equal(
      occurrenceSchema.safeParse({
        start: "1998-08-31T00:00:00Z",
        end: "1998-06-01T00:00:00Z",
        precision: "day",
      }).success,
      false,
    );
  });
});

describe("error codes", () => {
  it("classifies which failures a caller may retry", () => {
    assert.equal(isRetryable("CONCURRENCY_CONFLICT"), true);
    assert.equal(isRetryable("PROVIDER_UNAVAILABLE"), true);
    assert.equal(isRetryable("RATE_LIMITED"), true);
    assert.equal(isRetryable("AUTHORIZATION_DENIED"), false);
    assert.equal(isRetryable("VALIDATION_FAILED"), false);
  });

  it("rejects codes outside the stable set", () => {
    assert.equal(errorCodeSchema.safeParse("SOMETHING_WENT_WRONG").success, false);
  });
});

describe("event envelope", () => {
  const envelope = {
    eventId: uuid,
    eventType: "MomentRecorded",
    eventVersion: 1,
    occurredAt: "2026-08-14T10:30:00Z",
    aggregate: { type: "Moment", id: uuid, version: 3 },
    payload: { momentId: uuid },
  };

  it("accepts the documented envelope", () => {
    assert.ok(eventEnvelopeSchema.safeParse(envelope).success);
  });

  it("treats correlation, causation, and actor as optional", () => {
    const parsed = eventEnvelopeSchema.parse(envelope);
    assert.equal(parsed.correlationId, undefined);
    assert.equal(parsed.actor, undefined);
  });

  it("requires a non-negative aggregate version", () => {
    assert.equal(
      eventEnvelopeSchema.safeParse({
        ...envelope,
        aggregate: { ...envelope.aggregate, version: -1 },
      }).success,
      false,
    );
  });

  it("binds a typed payload to one event type", () => {
    const momentRecorded = envelopeOf("MomentRecorded", z.object({ momentId: identifierSchema }));

    assert.ok(momentRecorded.safeParse(envelope).success);
    assert.equal(
      momentRecorded.safeParse({ ...envelope, eventType: "SomethingElse" }).success,
      false,
    );
    assert.equal(
      momentRecorded.safeParse({ ...envelope, payload: { momentId: "nope" } }).success,
      false,
    );
  });

  it("emits JSON Schema for boundaries that speak it", () => {
    const jsonSchema = z.toJSONSchema(eventEnvelopeSchema, {
      unrepresentable: "any",
    });

    assert.equal(typeof jsonSchema, "object");
    assert.ok("properties" in jsonSchema);
  });
});

describe("branded identifiers", () => {
  it("separates identifier kinds without changing the serialized form", () => {
    const userId = brandedIdentifier<"UserId">();
    const parsed = userId.parse(uuid);

    assert.equal(parsed, uuid);
    assert.equal(typeof parsed, "string");
    assert.equal(userId.safeParse("not-a-uuid").success, false);
  });
});
