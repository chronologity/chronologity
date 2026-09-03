import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { encodeCursor } from "@chronologity/timeline-derivation";
import { GraphQLError, Kind } from "graphql";
import { describe, it } from "vitest";
import { cursorScalar } from "./cursor.scalar.js";

/**
 * The one value a client supplies that reaches the query.
 *
 * Two things are being protected. That a tampered cursor is refused rather than
 * interpreted — a cursor that decoded to something plausible but wrong would
 * page through the wrong part of somebody's history quietly. And that the
 * refusal is *semantic*: before this scalar existed the shared package's error
 * reached the formatter unrecognised and became "An unexpected error occurred",
 * which tells a client the service broke when in fact its request was refused.
 */

const POSITION = {
  kind: "timeline",
  occurredAt: new Date("1998-07-04T19:30:00.000Z"),
  momentId: randomUUID(),
} as const;

/** The code and message a refusal carried, or a failure if it did not refuse. */
const refusalFrom = (call: () => unknown): { code: unknown; message: string } => {
  try {
    call();
  } catch (error) {
    assert.ok(error instanceof GraphQLError);
    return { code: error.extensions["code"], message: error.message };
  }

  return assert.fail("expected the cursor to be refused");
};

const literal = (value: string) => ({ kind: Kind.STRING, value }) as const;

describe("the Cursor scalar", () => {
  it("carries a position out and back unchanged", () => {
    const encoded = cursorScalar.serialize(POSITION);

    assert.deepEqual(cursorScalar.parseValue(encoded), POSITION);
  });

  it("reads a cursor written into the query as well as one sent as a variable", () => {
    // GraphQL derives neither from the other, and a client will do both.
    const encoded = cursorScalar.serialize(POSITION);

    assert.deepEqual(cursorScalar.parseLiteral(literal(encoded)), POSITION);
  });

  it("refuses a cursor somebody edited, semantically", () => {
    const refusal = refusalFrom(() => cursorScalar.parseValue("not-a-real-cursor"));

    assert.equal(refusal.code, "VALIDATION_FAILED");
    assert.notEqual(refusal.code, "INTERNAL_ERROR");
  });

  it("refuses one from an encoding this Timeline cannot read", () => {
    const older = Buffer.from(JSON.stringify({ v: 0, t: 0, m: "x" }), "utf8").toString("base64url");

    const refusal = refusalFrom(() => cursorScalar.parseValue(older));

    assert.equal(refusal.code, "VALIDATION_FAILED");
    assert.match(refusal.message, /cursor/i);
  });

  it("says nothing about how a cursor is encoded", () => {
    // Somebody probing learns that their string was refused, which they knew.
    for (const supplied of ["not-a-real-cursor", "eyJ2IjowfQ", ""]) {
      const refusal = refusalFrom(() => cursorScalar.parseValue(supplied));

      for (const leak of [
        "base64",
        "JSON",
        "parse",
        "occurredAt",
        "momentId",
        "v:",
        "SyntaxError",
      ]) {
        assert.ok(
          !refusal.message.includes(leak),
          `a refusal mentioned ${leak}: ${refusal.message}`,
        );
      }
    }
  });

  it("never quotes the cursor back", () => {
    // A value echoed into an error is a value that reaches a log.
    const supplied = "a-string-somebody-sent";

    const refusal = refusalFrom(() => cursorScalar.parseValue(supplied));

    assert.ok(!refusal.message.includes(supplied));
  });

  it("refuses anything that is not a string", () => {
    for (const supplied of [42, null, undefined, {}, []]) {
      assert.equal(refusalFrom(() => cursorScalar.parseValue(supplied)).code, "VALIDATION_FAILED");
    }
  });

  it("refuses a literal that is not a string", () => {
    const refusal = refusalFrom(() =>
      cursorScalar.parseLiteral({ kind: Kind.INT, value: "42" } as never),
    );

    assert.equal(refusal.code, "VALIDATION_FAILED");
  });

  it("reports a position it cannot encode as this service's fault", () => {
    // The other direction, and it is not the client's doing — so it is an
    // internal error rather than a refusal.
    const refusal = refusalFrom(() => cursorScalar.serialize({ nothing: "useful" }));

    assert.equal(refusal.code, "INTERNAL_ERROR");
  });

  it("encodes the same position identically every time", () => {
    // Two encodings of one position must agree, or paging would depend on which
    // resolver produced the cursor.
    assert.equal(cursorScalar.serialize(POSITION), encodeCursor(POSITION));
  });
});
