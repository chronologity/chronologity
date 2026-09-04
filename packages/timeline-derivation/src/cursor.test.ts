import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import {
  boundaryCondition,
  CursorError,
  decodeCursor,
  encodeCursor,
  instantBoundary,
  orderFor,
} from "./cursor.js";

/**
 * Cursors, exhaustively.
 *
 * Everything in Timeline navigation rests on these: a cursor is the only
 * client-supplied value that reaches the query, and one misread would page
 * through the wrong part of history quietly. So every way a string can arrive
 * wrong is a case here rather than a hope.
 */

const summer1998 = new Date("1998-06-01T00:00:00.000Z");

describe("carrying a position through a client", () => {
  it("comes back as it went out", () => {
    const position = { occurredAt: summer1998, momentId: randomUUID() };

    const returned = decodeCursor(encodeCursor(position));

    assert.deepEqual(returned.occurredAt, position.occurredAt);
    assert.equal(returned.momentId, position.momentId);
  });

  it("keeps milliseconds, because the sort tuple has them", () => {
    // Two Moments a millisecond apart are two positions. A cursor that rounded
    // would resume on the wrong one, and only where they were that close.
    const position = {
      occurredAt: new Date("2004-07-13T09:15:22.837Z"),
      momentId: randomUUID(),
    };

    assert.equal(
      decodeCursor(encodeCursor(position)).occurredAt.getTime(),
      position.occurredAt.getTime(),
    );
  });

  it("carries history from before 1970", () => {
    // The ordinary case for a Timeline rather than an edge one: most history
    // predates the epoch, and a negative millisecond count must survive.
    const position = { occurredAt: new Date("1901-12-14T00:00:00.000Z"), momentId: randomUUID() };

    assert.deepEqual(decodeCursor(encodeCursor(position)).occurredAt, position.occurredAt);
  });

  it("survives a query string without escaping", () => {
    // Base64url rather than base64 for exactly this: `+` and `/` would be
    // mangled, and a cursor that only worked sometimes is worse than one that
    // never did.
    const cursor = encodeCursor({ occurredAt: summer1998, momentId: randomUUID() });

    assert.equal(encodeURIComponent(cursor), cursor);
  });

  it("gives two Moments at one instant different cursors", () => {
    const first = encodeCursor({ occurredAt: summer1998, momentId: randomUUID() });
    const second = encodeCursor({ occurredAt: summer1998, momentId: randomUUID() });

    assert.notEqual(first, second);
  });

  it("says nothing a client can read at a glance", () => {
    // Opaque rather than secret. `timeline.md:794` asks that clients not build
    // on the contents, and an encoding that spelled out a date invites exactly
    // that.
    const momentId = randomUUID();
    const cursor = encodeCursor({ occurredAt: summer1998, momentId });

    assert.equal(cursor.includes(momentId), false);
    assert.equal(cursor.includes("1998"), false);
  });
});

describe("a cursor that cannot be trusted", () => {
  const refused = (cursor: string, why: string) => {
    assert.throws(
      () => decodeCursor(cursor),
      (error: unknown) => error instanceof CursorError,
      why,
    );
  };

  it("refuses an empty string", () => {
    refused("", "an empty cursor was accepted");
  });

  it("refuses something that is not base64 at all", () => {
    refused("not a cursor!!", "arbitrary text was accepted");
  });

  it("refuses base64 that is not JSON", () => {
    refused(Buffer.from("hello", "utf8").toString("base64url"), "non-JSON was accepted");
  });

  it("refuses JSON that is not an object", () => {
    refused(Buffer.from("42", "utf8").toString("base64url"), "a bare number was accepted");
    refused(Buffer.from("null", "utf8").toString("base64url"), "null was accepted");
  });

  it("refuses a cursor with a field missing", () => {
    refused(
      Buffer.from(JSON.stringify({ v: 1, t: 0 }), "utf8").toString("base64url"),
      "no identifier",
    );
    refused(Buffer.from(JSON.stringify({ v: 1, m: "x" }), "utf8").toString("base64url"), "no time");
  });

  it("refuses a cursor whose time is not a number", () => {
    refused(
      Buffer.from(JSON.stringify({ v: 1, t: "1998", m: "x" }), "utf8").toString("base64url"),
      "a string time was accepted",
    );
    refused(
      Buffer.from(JSON.stringify({ v: 1, t: Number.NaN, m: "x" }), "utf8").toString("base64url"),
      "a non-finite time was accepted",
    );
  });

  it("refuses a cursor from an encoding this code does not know", () => {
    // Told apart from malformed on purpose. A client holding a cursor from
    // another release should start again; that is a different instruction from
    // "you sent nonsense", and only distinguishable if the version is checked
    // before the fields are.
    const older = Buffer.from(JSON.stringify({ v: 0, t: 0, m: "x" }), "utf8").toString("base64url");

    assert.throws(() => decodeCursor(older), /not one this Timeline can read/);
  });

  it("refuses a cursor from a newer encoding too, and says so neutrally", () => {
    // Not hypothetical: during a deployment a client that reached a new
    // instance sends its cursor to an old one. The check is inequality, so this
    // is refused — and the wording has to be true of it, which "that cursor is
    // from an older Timeline" was not.
    const newer = Buffer.from(JSON.stringify({ v: 99, t: 0, m: "x" }), "utf8").toString(
      "base64url",
    );

    assert.throws(() => decodeCursor(newer), /not one this Timeline can read/);
  });

  it("refuses a cursor somebody edited", () => {
    // The case that matters: a client altering the encoded position to reach
    // history it was not given. It fails here because the payload stops being
    // valid, and — since this sub-phase filters every query by author — would
    // reach nothing even if it did not.
    const cursor = encodeCursor({ occurredAt: summer1998, momentId: randomUUID() });

    refused(`${cursor}tampered`, "an altered cursor was accepted");
  });
});

describe("resuming from a cursor", () => {
  it("reads backwards through history for an older page, and forwards for a newer one", () => {
    assert.match(boundaryCondition("older"), /\(occurred_at, moment_id\) < \(/);
    assert.match(boundaryCondition("newer"), /\(occurred_at, moment_id\) > \(/);
  });

  it("compares the same tuple the cursor encodes, in the same order", () => {
    // The half of the cursor contract that lives in SQL. `encodeCursor` writes
    // (occurredAt, momentId); if this compared them the other way round, paging
    // across two Moments sharing an instant would skip one and repeat the other
    // — quietly, and only where they collide.
    for (const direction of ["older", "newer"] as const) {
      assert.match(boundaryCondition(direction), /\(occurred_at, moment_id\)/);
      assert.match(
        boundaryCondition(direction),
        /\(\{at: DateTime64\(3\)\}, \{momentId: String\}\)/,
      );
    }
  });

  it("excludes the row a cursor names, which is what stops a page repeating it", () => {
    // The default, and every existing caller relies on it. An inclusive resume
    // would return the last row of the previous page as the first of the next.
    assert.doesNotMatch(boundaryCondition("older"), /<=/);
    assert.doesNotMatch(boundaryCondition("newer"), />=/);
  });

  it("is character-for-character what it was when asked for the default", () => {
    // The parameter was added for landings. Every call site that predates it
    // passes one argument, and those queries must not have changed at all.
    assert.equal(
      boundaryCondition("older"),
      "AND (occurred_at, moment_id) < ({at: DateTime64(3)}, {momentId: String})",
    );
    assert.equal(
      boundaryCondition("newer"),
      "AND (occurred_at, moment_id) > ({at: DateTime64(3)}, {momentId: String})",
    );
    assert.equal(boundaryCondition("older"), boundaryCondition("older", false));
    assert.equal(boundaryCondition("newer"), boundaryCondition("newer", false));
  });

  it("includes the row a landing names, because the landing is the first of its page", () => {
    assert.equal(
      boundaryCondition("older", true),
      "AND (occurred_at, moment_id) <= ({at: DateTime64(3)}, {momentId: String})",
    );
    assert.equal(
      boundaryCondition("newer", true),
      "AND (occurred_at, moment_id) >= ({at: DateTime64(3)}, {momentId: String})",
    );
  });

  it("orders both columns, never occurrence alone", () => {
    // Occurrence alone leaves two Moments at the same instant in whatever order
    // the engine returns them, which changes between reads.
    assert.equal(orderFor("older"), "occurred_at DESC, moment_id DESC");
    assert.equal(orderFor("newer"), "occurred_at ASC, moment_id ASC");
  });

  it("orders the way the boundary reads", () => {
    // A page running backwards through history has to be ordered backwards, or
    // the first row of the page is not where the next cursor should be taken.
    assert.ok(boundaryCondition("older").includes("<") && orderFor("older").includes("DESC"));
    assert.ok(boundaryCondition("newer").includes(">") && orderFor("newer").includes("ASC"));
  });
});

describe("bounding a page at an instant", () => {
  it("puts everything at the instant on the older side, and nothing on the newer", () => {
    // The partition a landing depends on. An instant names no Moment, so it
    // cannot split Moments that share it — all of them belong to one side, and
    // `older` is that side because its first row is where the jump landed.
    assert.equal(instantBoundary("older"), "AND occurred_at <= {at: DateTime64(3)}");
    assert.equal(instantBoundary("newer"), "AND occurred_at > {at: DateTime64(3)}");
  });

  it("covers the whole axis once, overlapping nowhere", () => {
    // Read the two together: <= and > partition. Were both inclusive, a Moment
    // at the instant would appear in both halves of one landing; were both
    // strict, it would appear in neither.
    const older = instantBoundary("older");
    const newer = instantBoundary("newer");

    assert.ok(older.includes("<="));
    assert.ok(newer.includes(">") && !newer.includes(">="));
  });

  it("never names a Moment, so no caller can bind one", () => {
    // Binding a parameter the statement does not name is an error in the
    // driver, which is the point: the two forms cannot be confused at runtime.
    for (const direction of ["older", "newer"] as const) {
      assert.doesNotMatch(instantBoundary(direction), /momentId/);
      assert.doesNotMatch(instantBoundary(direction), /moment_id/);
    }
  });

  it("reads the same bound instant the tuple form does", () => {
    for (const direction of ["older", "newer"] as const) {
      assert.match(instantBoundary(direction), /\{at: DateTime64\(3\)\}/);
    }
  });
});
