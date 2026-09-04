import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { ValidationError } from "../../errors/aggregator-error.js";
import type { Position } from "../../pagination/cursors.js";
import { axisRequestFrom } from "./context-request.js";

/**
 * What a client asked for when moving sideways.
 *
 * The refusals matter more than the acceptances here. One of them — asking a
 * person's history which places it touches — is refused rather than answered
 * emptily, and that is a privacy decision rather than a validation one.
 */

const PLACE = randomUUID();
const AT = new Date("2026-06-01T00:00:00.000Z");

const standing = (over: Record<string, unknown> = {}) => ({
  scope: { type: "LOCATION", id: PLACE } as const,
  at: AT,
  ...over,
});

describe("where the reader is standing", () => {
  it("takes a place", () => {
    assert.deepEqual(axisRequestFrom(standing()).scope, { type: "location", id: PLACE });
  });

  it("takes an occasion", () => {
    const occasion = randomUUID();
    const request = axisRequestFrom(standing({ scope: { type: "REAL_WORLD_EVENT", id: occasion } }));

    assert.deepEqual(request.scope, { type: "real_world_event", id: occasion });
  });

  it("refuses a person, rather than answering emptily", () => {
    // "Which places does this person's history touch" is a whole-life location
    // trace. An empty answer would itself be a claim about them.
    assert.throws(
      () => axisRequestFrom(standing({ scope: { type: "PERSON", id: randomUUID() } })),
      ValidationError,
    );
  });

  it("refuses an identifier that is not one, before any store is touched", () => {
    assert.throws(
      () => axisRequestFrom(standing({ scope: { type: "LOCATION", id: "over-there" } })),
      ValidationError,
    );
  });

  it("keeps the point in time it was given", () => {
    assert.equal(axisRequestFrom(standing()).at.getTime(), AT.getTime());
  });
});

describe("how much of the axis", () => {
  it("takes the contract's default when no size is named", () => {
    assert.equal(axisRequestFrom(standing()).limit, 20);
  });

  it("takes a size within the bound", () => {
    assert.equal(axisRequestFrom(standing({ first: 40 })).limit, 40);
  });

  it("refuses more than the ceiling", () => {
    assert.throws(() => axisRequestFrom(standing({ first: 51 })), ValidationError);
  });

  it("refuses none", () => {
    assert.throws(() => axisRequestFrom(standing({ first: 0 })), ValidationError);
  });
});

describe("where the axis resumes", () => {
  const position = (tier: "shared" | "period"): Position => ({
    kind: "context",
    tier,
    shared: tier === "shared" ? 3 : 0,
    latest: new Date("2025-01-01T00:00:00.000Z"),
    contextType: "real_world_event",
    contextId: randomUUID(),
  });

  it("starts at the beginning when no cursor is given", () => {
    assert.equal(axisRequestFrom(standing()).from, undefined);
  });

  it("resumes in the tier the cursor came from", () => {
    assert.equal(axisRequestFrom(standing({ after: position("shared") })).from?.tier, "shared");
    assert.equal(axisRequestFrom(standing({ after: position("period") })).from?.tier, "period");
  });

  it("carries the whole sort key, since both tiers break ties on identity", () => {
    const supplied = position("shared");
    const from = axisRequestFrom(standing({ after: supplied })).from;

    assert.equal(from?.shared, 3);
    assert.equal(from?.contextType, "real_world_event");
    assert.ok(from?.contextId !== undefined);
  });

  it("refuses a cursor from a different connection", () => {
    const media: Position = { kind: "media", momentId: randomUUID(), position: 1 };

    assert.throws(() => axisRequestFrom(standing({ after: media })), ValidationError);
  });
});
