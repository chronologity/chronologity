import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { ValidationError } from "../../errors/aggregator-error.js";
import type { Position } from "../../pagination/cursors.js";
import {
  commentRequestFrom,
  mediaRequestFrom,
  momentIdFrom,
  relationshipLimitFrom,
} from "./moment-request.js";

/**
 * What a client asked for, bounded and checked.
 *
 * Every bound comes from the contract rather than from a number written beside
 * the field, so these assert that the translation reaches those rules — not that
 * the rules are what they are, which is the contract's own business.
 */

const MOMENT = randomUUID();
const ELSEWHERE = randomUUID();

const mediaCursor = (momentId: string, position: number): Position => ({
  kind: "media",
  momentId,
  position,
});

describe("naming a Moment", () => {
  it("takes an identifier", () => {
    assert.equal(momentIdFrom(MOMENT), MOMENT);
  });

  it("refuses something that is not one", () => {
    // Checked before it reaches a statement: it is compared against a `uuid`
    // column, and PostgreSQL raises rather than returning nothing — which would
    // surface as an internal error where a refusal was the right answer.
    assert.throws(() => momentIdFrom("a-moment-please"), ValidationError);
  });
});

describe("asking for media", () => {
  it("takes the contract's default when no size is named", () => {
    assert.equal(mediaRequestFrom({}, MOMENT).limit, 20);
  });

  it("takes a size within the bound", () => {
    assert.equal(mediaRequestFrom({ first: 50 }, MOMENT).limit, 50);
  });

  it("refuses a page past the ceiling", () => {
    assert.throws(() => mediaRequestFrom({ first: 101 }, MOMENT), ValidationError);
  });

  it("refuses a page of none", () => {
    assert.throws(() => mediaRequestFrom({ first: 0 }, MOMENT), ValidationError);
  });

  it("starts at the beginning when no cursor is given", () => {
    assert.equal(mediaRequestFrom({}, MOMENT).after, undefined);
  });

  it("resumes past a position", () => {
    assert.equal(mediaRequestFrom({ after: mediaCursor(MOMENT, 7) }, MOMENT).after, 7);
  });

  it("resumes past the first position, which is zero", () => {
    // Dense and zero-based, so a falsy check would page the first item away.
    assert.equal(mediaRequestFrom({ after: mediaCursor(MOMENT, 0) }, MOMENT).after, 0);
  });

  it("refuses a cursor from another Moment", () => {
    // Its ordinal would be meaningful here, which is the problem: it would
    // resume a different sequence at a number that happens to exist in this one.
    assert.throws(
      () => mediaRequestFrom({ after: mediaCursor(ELSEWHERE, 3) }, MOMENT),
      ValidationError,
    );
  });

  it("refuses a cursor for a different kind of sequence", () => {
    const timeline: Position = {
      kind: "timeline",
      occurredAt: new Date("2014-01-01T00:00:00Z"),
      momentId: MOMENT,
    };

    assert.throws(() => mediaRequestFrom({ after: timeline }, MOMENT), ValidationError);
  });
});

describe("asking for discussion", () => {
  const commentCursor = (): Position => ({
    kind: "comment",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    commentId: randomUUID(),
  });

  it("takes the contract's default when no size is named", () => {
    assert.equal(commentRequestFrom({}).limit, 20);
  });

  it("refuses a page past the ceiling", () => {
    assert.throws(() => commentRequestFrom({ first: 101 }), ValidationError);
  });

  it("reads the top level when no thread is named", () => {
    assert.equal(commentRequestFrom({}).thread, undefined);
  });

  it("reads a thread's replies when one is", () => {
    const thread = randomUUID();

    assert.equal(commentRequestFrom({ thread }).thread, thread);
  });

  it("refuses a thread that is not an identifier", () => {
    assert.throws(() => commentRequestFrom({ thread: "the-first-one" }), ValidationError);
  });

  it("resumes from a comment cursor", () => {
    const after = commentCursor();
    const request = commentRequestFrom({ after });

    assert.equal(request.after?.commentId, after.kind === "comment" ? after.commentId : "");
  });

  it("refuses a cursor for a different kind of sequence", () => {
    assert.throws(
      () => commentRequestFrom({ after: mediaCursor(MOMENT, 1) }),
      ValidationError,
    );
  });
});

describe("asking for relationships", () => {
  it("takes the contract's default when none is named", () => {
    assert.equal(relationshipLimitFrom({}), 100);
  });

  it("takes a smaller limit", () => {
    assert.equal(relationshipLimitFrom({ limit: 5 }), 5);
  });

  it("refuses more than the ceiling", () => {
    assert.throws(() => relationshipLimitFrom({ limit: 101 }), ValidationError);
  });

  it("refuses none", () => {
    assert.throws(() => relationshipLimitFrom({ limit: 0 }), ValidationError);
  });
});
