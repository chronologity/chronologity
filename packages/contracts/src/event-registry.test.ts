import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import {
  COMMENTS_BOUNDARY,
  LOCATIONS_BOUNDARY,
  MODERATION_BOUNDARY,
  MOMENTS_BOUNDARY,
  REACTIONS_BOUNDARY,
  REAL_WORLD_EVENTS_BOUNDARY,
  SECURITY_BOUNDARY,
  SOCIAL_BOUNDARY,
  USERS_BOUNDARY,
} from "./domain-events.js";
import { EVENT_REGISTRY, boundaryOf, registeredEvent } from "./event-registry.js";
import { MEDIA_BOUNDARY } from "./media-events.js";

const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const envelopeAround = (type: string, version: number, payload: unknown) => ({
  eventId: uuid,
  eventType: type,
  eventVersion: version,
  occurredAt: "2026-08-27T09:15:00Z",
  aggregate: { type: "thing", id: uuid, version: 1 },
  payload,
});

const BOUNDARIES = [
  COMMENTS_BOUNDARY,
  LOCATIONS_BOUNDARY,
  MEDIA_BOUNDARY,
  MODERATION_BOUNDARY,
  MOMENTS_BOUNDARY,
  REACTIONS_BOUNDARY,
  REAL_WORLD_EVENTS_BOUNDARY,
  SECURITY_BOUNDARY,
  SOCIAL_BOUNDARY,
  USERS_BOUNDARY,
];

describe("the event registry", () => {
  it("registers every event exactly once", () => {
    const types = EVENT_REGISTRY.map((event) => event.type);

    assert.equal(new Set(types).size, types.length, "two entries share a type");
  });

  it("never lets two entries collide on type and version", () => {
    const pairs = EVENT_REGISTRY.map((event) => `${event.type}@${event.version}`);

    assert.equal(new Set(pairs).size, pairs.length);
  });

  it("publishes only to boundaries the contracts declare", () => {
    for (const event of EVENT_REGISTRY) {
      assert.ok(
        BOUNDARIES.includes(event.boundary),
        `${event.type} names a boundary nothing exports: ${event.boundary}`,
      );
    }
  });

  it("names an owner and a classification for every event", () => {
    for (const event of EVENT_REGISTRY) {
      assert.ok(event.owner.length > 0, `${event.type} has no owner`);
      assert.equal(event.classification, "integration", `${event.type} is classified oddly`);
      assert.ok(Number.isInteger(event.version) && event.version > 0);
    }
  });

  it("finds an event by the name it travels under", () => {
    for (const event of EVENT_REGISTRY) {
      assert.equal(registeredEvent(event.type), event);
      assert.equal(boundaryOf(event.type), event.boundary);
    }
  });

  it("knows nothing about a type it does not publish", () => {
    assert.equal(registeredEvent("SomethingElseHappened"), undefined);
    assert.equal(boundaryOf("SomethingElseHappened"), undefined);
  });
});

describe("every registered payload", () => {
  for (const event of EVENT_REGISTRY) {
    describe(event.type, () => {
      it("accepts its documented example", () => {
        assert.equal(event.payload.safeParse(event.example).success, true);
        assert.equal(
          event.envelope.safeParse(envelopeAround(event.type, event.version, event.example))
            .success,
          true,
        );
      });

      it("refuses an envelope carrying a different type", () => {
        assert.equal(
          event.envelope.safeParse(
            envelopeAround("SomethingElseHappened", event.version, event.example),
          ).success,
          false,
        );
      });

      it("requires every field the example carries", () => {
        // The whole point of the registry. Without this, removing a field or
        // making an optional one required passes every test in the repository
        // and breaks a consumer that was promised otherwise.
        for (const field of Object.keys(event.example)) {
          const withoutIt: Record<string, unknown> = { ...event.example };
          delete withoutIt[field];

          assert.equal(
            event.payload.safeParse(withoutIt).success,
            false,
            `${event.type} accepted a payload with no ${field}`,
          );
        }
      });
    });
  }
});

/**
 * Names that must never appear in anything append-only (ADR-095), and names
 * that would contradict the doctrine these payloads are written to: they say
 * what changed, never what it now says.
 *
 * Matched against property names rather than values, because a value is one
 * example and a name is the contract.
 */
const FORBIDDEN = [
  /email/i,
  /address/i,
  /phone/i,
  /password/i,
  /credential/i,
  /secret/i,
  /token/i,
  /hash/i,
  /birth|dob/i,
  /caption/i,
  /displayname|handle/i,
  /body|text/i,
];

/**
 * Every property name a schema can produce, however deeply nested.
 *
 * @param schema - The payload schema.
 * @returns The names, so a nested object cannot smuggle one past the check.
 */
function propertyNames(schema: z.ZodType): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;

    const record = node as Record<string, unknown>;
    const properties = record.properties;

    if (properties !== null && typeof properties === "object") {
      found.push(...Object.keys(properties as Record<string, unknown>));
    }

    for (const value of Object.values(record)) {
      walk(value);
    }
  };

  walk(z.toJSONSchema(schema, { unrepresentable: "any" }));

  return found;
}

describe("what a payload may never carry", () => {
  it("keeps secrets and erasable personal data out of every registered event", () => {
    for (const event of EVENT_REGISTRY) {
      for (const name of propertyNames(event.payload)) {
        for (const pattern of FORBIDDEN) {
          assert.equal(
            pattern.test(name),
            false,
            `${event.type} carries ${name}, which ${String(pattern)} forbids`,
          );
        }
      }
    }
  });

  it("is checking something", () => {
    // A guard over property names is only as good as its ability to find one.
    // Without this, a walk that returned nothing would pass silently.
    assert.ok(propertyNames(z.object({ emailAddress: z.string() })).includes("emailAddress"));
    assert.ok(
      propertyNames(z.object({ outer: z.object({ passwordHash: z.string() }) })).includes(
        "passwordHash",
      ),
    );
  });
});
