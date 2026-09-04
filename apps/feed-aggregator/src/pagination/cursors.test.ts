import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CursorError, encodeCursor } from "@chronologity/timeline-derivation";
import { describe, it } from "vitest";
import { ValidationError } from "../errors/aggregator-error.js";
import { decodePosition, encodePosition, expectKind } from "./cursors.js";

/**
 * One opaque string, three things being paged.
 *
 * Two properties are load-bearing here and neither is obvious. A Timeline cursor
 * must still be exactly the bytes the shared codec produces, or a cursor
 * somebody stored last month stops working and the API's stop interoperating.
 * And a cursor handed to the wrong connection must be refused rather than
 * resumed, because the shapes are close enough that the wrong one decodes to
 * something plausible.
 */

const MOMENT = randomUUID();
const COMMENT = randomUUID();
const AT = new Date("1998-07-04T19:30:00.000Z");

describe("a Timeline position", () => {
  it("encodes to exactly what the shared codec produces", () => {
    // The interoperability guarantee. `apps/api` issues cursors with the shared
    // codec and clients hold them across releases; a byte of difference here
    // would break both without either noticing until somebody paged.
    const position = { occurredAt: AT, momentId: MOMENT };

    assert.equal(encodePosition({ kind: "timeline", ...position }), encodeCursor(position));
  });

  it("reads back a cursor the shared codec wrote", () => {
    const decoded = decodePosition(encodeCursor({ occurredAt: AT, momentId: MOMENT }));

    assert.deepEqual(decoded, { kind: "timeline", occurredAt: AT, momentId: MOMENT });
  });

  it("survives a round trip", () => {
    const position = { kind: "timeline", occurredAt: AT, momentId: MOMENT } as const;

    assert.deepEqual(decodePosition(encodePosition(position)), position);
  });
});

describe("a media position", () => {
  it("survives a round trip", () => {
    const position = { kind: "media", momentId: MOMENT, position: 42 } as const;

    assert.deepEqual(decodePosition(encodePosition(position)), position);
  });

  it("carries the Moment it belongs to, not only the ordinal", () => {
    // So a cursor taken from one Moment's media is refused by another's rather
    // than silently resuming at the same ordinal of a different sequence.
    const decoded = decodePosition(
      encodePosition({ kind: "media", momentId: MOMENT, position: 3 }),
    );

    assert.equal(expectKind(decoded, "media").momentId, MOMENT);
  });

  it("keeps the first position, which is zero", () => {
    // Positions are dense and zero-based, so a falsy check on one would page
    // the first item away.
    const position = { kind: "media", momentId: MOMENT, position: 0 } as const;

    assert.deepEqual(decodePosition(encodePosition(position)), position);
  });
});

describe("a comment position", () => {
  it("survives a round trip", () => {
    const position = { kind: "comment", createdAt: AT, commentId: COMMENT } as const;

    assert.deepEqual(decodePosition(encodePosition(position)), position);
  });

  it("keeps the instant to the millisecond", () => {
    // Two comments written in the same millisecond are broken apart by the
    // identifier, so the instant has to survive exactly for that to work.
    const createdAt = new Date("2026-01-02T03:04:05.678Z");
    const decoded = decodePosition(
      encodePosition({ kind: "comment", createdAt, commentId: COMMENT }),
    );

    assert.equal(expectKind(decoded, "comment").createdAt.getTime(), createdAt.getTime());
  });
});

describe("a position on the horizontal axis", () => {
  const shared = {
    kind: "context",
    tier: "shared",
    shared: 4,
    latest: AT,
    contextType: "location",
    contextId: MOMENT,
  } as const;

  it("survives a round trip", () => {
    assert.deepEqual(decodePosition(encodePosition(shared)), shared);
  });

  it("remembers which tier it was in", () => {
    // The axis runs in two, ordered differently, and the boundary is crossed
    // exactly once — so paging has to know which one it is walking.
    const period = {
      kind: "context",
      tier: "period",
      shared: 0,
      latest: AT,
      contextType: "real_world_event",
      contextId: COMMENT,
    } as const;

    assert.deepEqual(decodePosition(encodePosition(period)), period);
  });

  it("keeps a share count of zero, which the second tier always has", () => {
    const none = { ...shared, tier: "period", shared: 0 } as const;

    assert.deepEqual(decodePosition(encodePosition(none)), none);
  });

  it("is refused where a Timeline is paged", () => {
    assert.throws(() => expectKind(decodePosition(encodePosition(shared)), "timeline"), ValidationError);
  });

  it("is refused where media is paged", () => {
    assert.throws(() => expectKind(decodePosition(encodePosition(shared)), "media"), ValidationError);
  });

  it("refuses a tagged cursor missing its tier", () => {
    const forged = Buffer.from(
      JSON.stringify({ v: 1, k: "x", n: 1, t: AT.getTime(), ct: "location", ci: MOMENT }),
      "utf8",
    ).toString("base64url");

    assert.throws(() => decodePosition(forged), CursorError);
  });
});

describe("a cursor given to the wrong connection", () => {
  it("refuses a Timeline cursor where media is paged", () => {
    const timeline = decodePosition(encodePosition({ kind: "timeline", occurredAt: AT, momentId: MOMENT }));

    assert.throws(() => expectKind(timeline, "media"), ValidationError);
  });

  it("refuses a media cursor where a Timeline is paged", () => {
    const media = decodePosition(encodePosition({ kind: "media", momentId: MOMENT, position: 1 }));

    assert.throws(() => expectKind(media, "timeline"), ValidationError);
  });

  it("refuses a Timeline cursor where the axis is paged", () => {
    const timeline = decodePosition(
      encodePosition({ kind: "timeline", occurredAt: AT, momentId: MOMENT }),
    );

    assert.throws(() => expectKind(timeline, "context"), ValidationError);
  });

  it("refuses a comment cursor where media is paged", () => {
    const comment = decodePosition(
      encodePosition({ kind: "comment", createdAt: AT, commentId: COMMENT }),
    );

    assert.throws(() => expectKind(comment, "media"), ValidationError);
  });

  it("says which connection refused it, and nothing about the encoding", () => {
    const media = decodePosition(encodePosition({ kind: "media", momentId: MOMENT, position: 1 }));

    assert.throws(
      () => expectKind(media, "timeline"),
      (error: unknown) => {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.code, "VALIDATION_FAILED");

        for (const leak of ["base64", "JSON", "media", "position"]) {
          assert.ok(!error.message.includes(leak), `a refusal mentioned ${leak}`);
        }

        return true;
      },
    );
  });

  it("lets a cursor through to the connection it belongs to", () => {
    const media = decodePosition(encodePosition({ kind: "media", momentId: MOMENT, position: 7 }));

    assert.equal(expectKind(media, "media").position, 7);
  });
});

describe("a cursor this system did not issue", () => {
  it("refuses one that is not readable at all", () => {
    assert.throws(() => decodePosition("not-a-cursor"), CursorError);
  });

  it("refuses one that was truncated", () => {
    const whole = encodePosition({ kind: "media", momentId: MOMENT, position: 5 });

    assert.throws(() => decodePosition(whole.slice(0, whole.length - 6)), CursorError);
  });

  it("refuses a version this encoding does not know", () => {
    const forged = Buffer.from(JSON.stringify({ v: 99, k: "m", i: MOMENT, p: 1 }), "utf8").toString(
      "base64url",
    );

    assert.throws(() => decodePosition(forged), CursorError);
  });

  it("refuses a tagged cursor missing what its kind needs", () => {
    const forged = Buffer.from(JSON.stringify({ v: 1, k: "m", i: MOMENT }), "utf8").toString(
      "base64url",
    );

    assert.throws(() => decodePosition(forged), CursorError);
  });

  it("refuses a media position that is not a whole number", () => {
    const forged = Buffer.from(
      JSON.stringify({ v: 1, k: "m", i: MOMENT, p: 1.5 }),
      "utf8",
    ).toString("base64url");

    assert.throws(() => decodePosition(forged), CursorError);
  });

  it("says nothing about the encoding when it refuses", () => {
    assert.throws(
      () => decodePosition("!!!!"),
      (error: unknown) => {
        assert.ok(error instanceof CursorError);

        for (const leak of ["base64", "JSON", "SyntaxError", "occurredAt"]) {
          assert.ok(!error.message.includes(leak), `a refusal mentioned ${leak}`);
        }

        return true;
      },
    );
  });
});
