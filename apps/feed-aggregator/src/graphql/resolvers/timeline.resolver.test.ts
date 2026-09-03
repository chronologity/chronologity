import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { contextReturning, reading } from "../../testing/timeline-context.js";
import { timelineEntryResolver, timelineQueries } from "./timeline.resolver.js";

/**
 * The resolvers, as the thin things they are meant to be.
 *
 * Composition is tested where it lives, under `timelines/queries/`. What is left
 * here is what the resolvers themselves own: that each field reaches its query
 * function, and that the union names the right type for a row.
 *
 * A resolver test that grew assertions about ordering or eligibility would be
 * evidence the resolver had grown the logic to go with them.
 */

const PERSON = randomUUID();
const view = { scope: { type: "PERSON", id: PERSON } } as const;

describe("the Timeline fields on Query", () => {
  it("answers a page", async () => {
    const row = reading(PERSON);
    const context = contextReturning(PERSON, { rows: [row], more: false });

    const connection = await timelineQueries.timeline(undefined, { view, first: 10 }, context);

    assert.deepEqual(
      connection.edges.map((edge) => edge.node.momentId),
      [row.moment_id],
    );
  });

  it("answers a head", async () => {
    const row = reading(PERSON);
    const context = contextReturning(PERSON, { rows: [row], more: false });

    const head = await timelineQueries.timelineHead(undefined, { view }, context);

    assert.equal(head?.momentId, row.moment_id);
  });
});

describe("which kind of entry a row is", () => {
  it("names a readable Moment's type", () => {
    assert.equal(
      timelineEntryResolver.resolveType({
        readable: true,
        momentId: randomUUID(),
        occurredAt: new Date(),
        occurrenceEnd: new Date(),
        occurrencePrecision: "INSTANT",
        occurrenceOffsetMinutes: 0,
        visibility: "PUBLIC",
        discoverable: true,
      }),
      "ReadableTimelineEntry",
    );
  });

  it("names a withheld Moment's type", () => {
    assert.equal(
      timelineEntryResolver.resolveType({
        readable: false,
        momentId: randomUUID(),
        occurredAt: new Date(),
        occurrenceEnd: new Date(),
        occurrencePrecision: "INSTANT",
      }),
      "WithheldTimelineEntry",
    );
  });
});
