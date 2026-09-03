import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { contextReturning, reading, type Asked } from "../../testing/timeline-context.js";
import { getTimelineSlice } from "./get-timeline-slice.query.js";

/**
 * A page of history, composed.
 *
 * What the store returns is settled by the integration suite. What is settled
 * here is the composition: that a supplied cursor is passed through as the
 * position to resume from, and that both sides of `pageInfo` are answered from
 * the one read.
 */

const PERSON = randomUUID();
const view = { scope: { type: "PERSON", id: PERSON } } as const;

describe("paging a Timeline", () => {
  it("reports a page reached without a cursor as having nothing before it", async () => {
    const context = contextReturning(PERSON, { rows: [reading(PERSON)], more: true });

    const connection = await getTimelineSlice(view, { first: 10 }, context);

    assert.equal(connection.pageInfo.hasPreviousPage, false);
    assert.equal(connection.pageInfo.hasNextPage, true);
  });

  it("resumes from a supplied cursor, and says there is something before it", async () => {
    const asked: Asked = {};
    const after = {
      kind: "timeline",
      occurredAt: new Date("2015-01-01T00:00:00Z"),
      momentId: randomUUID(),
    } as const;
    const context = contextReturning(PERSON, { rows: [reading(PERSON)], more: false }, asked);

    const connection = await getTimelineSlice(view, { first: 10, after }, context);

    assert.deepEqual(asked.from, after);
    assert.equal(connection.pageInfo.hasPreviousPage, true);
  });

  it("carries the scope so a client can restore where it was", async () => {
    const context = contextReturning(PERSON, { rows: [], more: false });

    const connection = await getTimelineSlice(view, {}, context);

    assert.deepEqual(connection.scope, { type: "PERSON", id: PERSON });
  });
});
