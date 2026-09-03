import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { contextReturning, reading, type Asked } from "../../testing/timeline-context.js";
import { getTimelineHead } from "./get-timeline-head.query.js";

/**
 * Where a Timeline opens.
 *
 * Two decisions live here and nothing else does: that a Timeline holding nothing
 * opens at nothing rather than at an error, and that the head is asked for as a
 * page of one walking into the past — so that where a Timeline opens and where
 * paging would take it cannot disagree.
 */

const PERSON = randomUUID();
const view = { scope: { type: "PERSON", id: PERSON } } as const;

describe("opening a Timeline", () => {
  it("opens at its newest occurrence", async () => {
    const row = reading(PERSON);

    const head = await getTimelineHead(view, contextReturning(PERSON, { rows: [row], more: false }));

    assert.equal(head?.momentId, row.moment_id);
  });

  it("asks for one Moment, walking into the past", async () => {
    const asked: Asked = {};

    await getTimelineHead(view, contextReturning(PERSON, { rows: [], more: false }, asked));

    assert.equal(asked.view?.limit, 1);
    assert.equal(asked.view?.direction, "older");
    assert.equal(asked.from, undefined);
  });

  it("answers nothing for a Timeline holding none", async () => {
    const context = contextReturning(PERSON, { rows: [], more: false });

    assert.equal(await getTimelineHead(view, context), null);
  });
});
