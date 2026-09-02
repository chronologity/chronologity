import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ValidationError } from "../errors/validation-error.js";
import { deadLetterTopic, partitionKeyForAggregate, topicName } from "./topics.js";

describe("topicName", () => {
  it("names a topic for a boundary and version", () => {
    assert.equal(topicName("uploads"), "chronologity.uploads.v1");
  });

  it("puts the major version in the name", () => {
    // A breaking envelope change ships as a new topic while consumers migrate,
    // rather than as a reinterpretation of messages already in flight.
    assert.equal(topicName("uploads", 2), "chronologity.uploads.v2");
    assert.equal(topicName("uploads", 10), "chronologity.uploads.v10");
  });

  it("accepts hyphens and digits inside a boundary", () => {
    assert.equal(topicName("real-world-events"), "chronologity.real-world-events.v1");
    assert.equal(topicName("s3-uploads"), "chronologity.s3-uploads.v1");
  });

  it("refuses a boundary that would produce an unusable name", () => {
    for (const boundary of ["", "Uploads", "up loads", "up.loads", "-uploads", "up_loads", "9lives"]) {
      assert.throws(
        () => topicName(boundary),
        ValidationError,
        `expected ${JSON.stringify(boundary)} to be refused`,
      );
    }
  });

  it("refuses a version that is not a positive integer", () => {
    for (const version of [0, -1, 1.5]) {
      assert.throws(() => topicName("uploads", version), ValidationError);
    }
  });

  it("names the offending input in the refusal, without guessing a correction", () => {
    assert.throws(
      () => topicName("Not Valid", 3),
      (error: unknown) => {
        assert.ok(error instanceof ValidationError);
        assert.deepEqual(error.details, { boundary: "Not Valid", majorVersion: 3 });
        return true;
      },
    );
  });
});

describe("deadLetterTopic", () => {
  it("derives the dead-letter topic from the topic it came from", () => {
    assert.equal(deadLetterTopic("chronologity.uploads.v1"), "chronologity.uploads.v1.dlq");
  });

  it("keeps the version, so a poison message stays with its contract", () => {
    // A message that could not be decoded as v2 is evidence about v2. Pooling
    // it with v1 failures would lose which contract it was published under.
    assert.equal(deadLetterTopic("chronologity.uploads.v2"), "chronologity.uploads.v2.dlq");
    assert.notEqual(
      deadLetterTopic("chronologity.uploads.v1"),
      deadLetterTopic("chronologity.uploads.v2"),
    );
  });

  it("is not itself a valid boundary topic, so a dead letter cannot be consumed as live traffic", () => {
    const dlq = deadLetterTopic(topicName("uploads"));

    assert.throws(() => topicName(dlq), ValidationError);
  });
});

describe("partitionKeyForAggregate", () => {
  it("keys by the aggregate, which is the boundary ordering is required within", () => {
    assert.equal(partitionKeyForAggregate("abc"), "abc");
  });

  it("gives different aggregates different keys, so unrelated work is not serialised", () => {
    assert.notEqual(partitionKeyForAggregate("abc"), partitionKeyForAggregate("def"));
  });
});
