import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { registeredEvent } from "@chronologity/contracts";
import type { ConsumedEvent } from "../../lib/messaging/consumer.js";
import { SEARCH_INDEXER_EVENTS, subjectOf } from "./index-event.js";

const message = (eventType: string, payload: unknown): ConsumedEvent => ({
  topic: "chronologity.domain-moments.v1",
  partition: 0,
  offset: "0",
  envelope: {
    eventId: randomUUID(),
    eventType,
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    aggregate: { type: "thing", id: randomUUID(), version: 1 },
    payload,
  },
});

/** What each handled event should resolve to, and which field carries it. */
const EXPECTED: Readonly<Record<string, { entityType: string; field: string }>> = {
  MomentRecorded: { entityType: "moment", field: "momentId" },
  MomentRevised: { entityType: "moment", field: "momentId" },
  MomentVisibilityChanged: { entityType: "moment", field: "momentId" },
  MomentRemoved: { entityType: "moment", field: "momentId" },
  UserCreated: { entityType: "user", field: "userId" },
  UserProfileChanged: { entityType: "user", field: "userId" },
  UserStatusChanged: { entityType: "user", field: "userId" },
  RealWorldEventRecorded: { entityType: "event", field: "realWorldEventId" },
  RealWorldEventRevised: { entityType: "event", field: "realWorldEventId" },
  LocationRecorded: { entityType: "location", field: "locationId" },
  LocationRevised: { entityType: "location", field: "locationId" },
  ModerationStateChanged: { entityType: "moment", field: "subjectId" },
};

describe("reading which entity a message concerns", () => {
  it("has an expectation for everything it handles", () => {
    // Without this the loop below silently shrinks when a handler is removed.
    assert.deepEqual([...SEARCH_INDEXER_EVENTS].sort(), Object.keys(EXPECTED).sort());
  });

  for (const eventType of SEARCH_INDEXER_EVENTS) {
    it(`reads ${eventType} from its documented payload`, () => {
      const example = registeredEvent(eventType)?.example;
      const expected = EXPECTED[eventType]!;

      assert.notEqual(example, undefined, `${eventType} is not registered`);

      const subject = subjectOf(message(eventType, example));

      assert.equal(subject?.entityType, expected.entityType);
      assert.equal(subject?.entityId, example![expected.field]);
    });

    it(`ignores ${eventType} with no identifier`, () => {
      const example = { ...registeredEvent(eventType)!.example };
      delete example[EXPECTED[eventType]!.field];

      assert.equal(subjectOf(message(eventType, example)), undefined);
    });
  }

  it("ignores an event type it was never taught", () => {
    // Additive change rather than outage: a boundary gains types over time.
    assert.equal(subjectOf(message("SomethingElseHappened", { momentId: randomUUID() })), undefined);
  });

  it("ignores an identifier that is not a string", () => {
    assert.equal(subjectOf(message("MomentRecorded", { momentId: 42 })), undefined);
    assert.equal(subjectOf(message("MomentRecorded", { momentId: "" })), undefined);
  });
});

describe("moderation, whose subjects are not all indexed", () => {
  const moderated = (subjectType: string) =>
    message("ModerationStateChanged", {
      subjectType,
      subjectId: randomUUID(),
      state: "removed",
      affectedUserId: randomUUID(),
      changedAt: new Date().toISOString(),
    });

  it("indexes a moderated Moment", () => {
    assert.equal(subjectOf(moderated("moment"))?.entityType, "moment");
  });

  it("indexes a moderated account", () => {
    assert.equal(subjectOf(moderated("user"))?.entityType, "user");
  });

  it("indexes nothing for a comment, which has no document of its own", () => {
    assert.equal(subjectOf(moderated("comment")), undefined);
  });

  it("indexes nothing for a medium, which reaches Search through its Moment", () => {
    assert.equal(subjectOf(moderated("media")), undefined);
  });

  it("indexes nothing for a subject kind it does not recognise", () => {
    assert.equal(subjectOf(moderated("something-else")), undefined);
  });
});
