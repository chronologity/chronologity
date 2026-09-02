import assert from "node:assert/strict";
import { GraphQLError, Kind } from "graphql";
import { describe, it } from "vitest";
import { dateTimeScalar } from "./date-time.scalar.js";

/**
 * When something happened, said unambiguously.
 *
 * The property worth protecting is the offset. A timestamp without one is not a
 * fact about history, and assuming UTC would silently move a Moment by up to
 * fourteen hours — which for a product whose whole subject is when things
 * happened is not a rounding error.
 */

const refusalFrom = (call: () => unknown): { code: unknown; message: string } => {
  try {
    call();
  } catch (error) {
    assert.ok(error instanceof GraphQLError);
    return { code: error.extensions["code"], message: error.message };
  }

  return assert.fail("expected the time to be refused");
};

const literal = (value: string) => ({ kind: Kind.STRING, value }) as const;

describe("the DateTime scalar", () => {
  it("accepts an instant in UTC", () => {
    assert.deepEqual(
      dateTimeScalar.parseValue("1998-07-04T19:30:00.000Z"),
      new Date("1998-07-04T19:30:00.000Z"),
    );
  });

  it("accepts an instant with a numeric offset", () => {
    assert.deepEqual(
      dateTimeScalar.parseValue("1998-07-04T19:30:00+02:00"),
      new Date("1998-07-04T17:30:00.000Z"),
    );
  });

  it("refuses one with no offset rather than assuming UTC", () => {
    // The case this scalar exists for. Assuming would move history quietly.
    const refusal = refusalFrom(() => dateTimeScalar.parseValue("1998-07-04T19:30:00"));

    assert.equal(refusal.code, "VALIDATION_FAILED");
    assert.match(refusal.message, /offset/);
  });

  it("refuses a date with no time at all", () => {
    assert.equal(
      refusalFrom(() => dateTimeScalar.parseValue("1998-07-04")).code,
      "VALIDATION_FAILED",
    );
  });

  it("refuses a day that did not happen", () => {
    // Shape alone is not enough: this matches the pattern and is not a date.
    const refusal = refusalFrom(() => dateTimeScalar.parseValue("2026-02-30T00:00:00Z"));

    assert.equal(refusal.code, "VALIDATION_FAILED");
  });

  it("refuses anything that is not a string", () => {
    for (const supplied of [42, null, undefined, {}, new Date()]) {
      assert.equal(
        refusalFrom(() => dateTimeScalar.parseValue(supplied)).code,
        "VALIDATION_FAILED",
      );
    }
  });

  it("reads a time written into the query as well as one sent as a variable", () => {
    assert.deepEqual(
      dateTimeScalar.parseLiteral(literal("1969-07-20T20:17:00.000Z")),
      new Date("1969-07-20T20:17:00.000Z"),
    );
  });

  it("refuses a literal that is not a string", () => {
    const refusal = refusalFrom(() =>
      dateTimeScalar.parseLiteral({ kind: Kind.INT, value: "42" } as never),
    );

    assert.equal(refusal.code, "VALIDATION_FAILED");
  });

  it("sends instants in UTC, always with an offset", () => {
    assert.equal(
      dateTimeScalar.serialize(new Date("1998-07-04T17:30:00.000Z")),
      "1998-07-04T17:30:00.000Z",
    );
  });

  it("carries history before 1970 as readily as after it", () => {
    // Negative epoch times. The product is about the past, so this is the
    // ordinary case rather than an edge.
    const moonwalk = new Date("1969-07-20T20:17:00.000Z");

    assert.equal(dateTimeScalar.serialize(moonwalk), "1969-07-20T20:17:00.000Z");
    assert.deepEqual(
      dateTimeScalar.parseValue("1901-01-01T00:00:00.000Z"),
      new Date("1901-01-01T00:00:00.000Z"),
    );
  });

  it("reports an instant it cannot produce as this service's fault", () => {
    const refusal = refusalFrom(() => dateTimeScalar.serialize("not a time"));

    assert.equal(refusal.code, "INTERNAL_ERROR");
  });
});

describe("the calendar", () => {
  it("accepts the 29th of February in a leap year", () => {
    assert.deepEqual(
      dateTimeScalar.parseValue("2024-02-29T00:00:00.000Z"),
      new Date("2024-02-29T00:00:00.000Z"),
    );
  });

  it("refuses it in a year that had no 29th", () => {
    // The pair that proves this is a calendar check rather than a fixed rule.
    // JavaScript would roll it to the 1st of March without a word.
    assert.equal(
      refusalFrom(() => dateTimeScalar.parseValue("2026-02-29T00:00:00.000Z")).code,
      "VALIDATION_FAILED",
    );
  });

  it("refuses a month with no 31st", () => {
    assert.equal(
      refusalFrom(() => dateTimeScalar.parseValue("2026-04-31T00:00:00.000Z")).code,
      "VALIDATION_FAILED",
    );
  });

  it("accepts history far enough back to have a two-digit year", () => {
    // How far back Chronologity reaches is not this scalar's business, and the
    // obvious implementation would have read the year 50 as 1950.
    assert.deepEqual(
      dateTimeScalar.parseValue("0050-01-01T00:00:00.000Z"),
      new Date("0050-01-01T00:00:00.000Z"),
    );
  });
});
