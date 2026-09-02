import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ValidationError } from "../errors/validation-error.js";
import { decodeCursor, encodeCursor } from "./cursor.js";

describe("encodeCursor", () => {
  it("carries both halves through a round trip", () => {
    const at = new Date("2026-08-22T10:30:00.000Z");

    const decoded = decodeCursor(encodeCursor(at, "a-b-c"));

    assert.deepEqual(decoded, { at, id: "a-b-c" });
  });

  it("says nothing a caller could read", () => {
    const encoded = encodeCursor(new Date("2026-08-22T10:30:00.000Z"), "a-b-c");

    assert.equal(encoded.includes("2026"), false);
    assert.equal(encoded.includes("a-b-c"), false);
  });

  it("survives an identifier containing the separator", () => {
    const at = new Date("2026-08-22T10:30:00.000Z");

    const decoded = decodeCursor(encodeCursor(at, "with:colons:inside"));

    assert.deepEqual(decoded, { at, id: "with:colons:inside" });
  });

  it("refuses an identifier it could not read back", () => {
    const at = new Date("2026-08-22T10:30:00.000Z");

    assert.throws(() => encodeCursor(at, "has a Z in it"), /Cannot encode/);
    assert.throws(() => encodeCursor(at, ""), /Cannot encode/);
  });
});

describe("decodeCursor", () => {
  it("returns nothing for the first page", () => {
    assert.equal(decodeCursor(undefined), undefined);
  });

  it("refuses a bare timestamp, which is the near miss that matters", () => {
    const encoded = Buffer.from("2026-08-22T10:30:00.000Z", "utf8").toString("base64url");

    assert.throws(() => decodeCursor(encoded), ValidationError);
  });

  it("refuses a cursor whose halves are not separated", () => {
    const encoded = Buffer.from("2026-08-22T10:30:00.000Za-b-c", "utf8").toString("base64url");

    assert.throws(() => decodeCursor(encoded), ValidationError);
  });

  it("refuses a cursor whose moment is not a date", () => {
    const encoded = Buffer.from("not-a-date:a-b-c", "utf8").toString("base64url");

    assert.throws(() => decodeCursor(encoded), ValidationError);
  });

  it("refuses a cursor with no identifier", () => {
    const encoded = Buffer.from("2026-08-22T10:30:00.000Z:", "utf8").toString("base64url");

    assert.throws(() => decodeCursor(encoded), ValidationError);
  });

  it("refuses something that was never a cursor", () => {
    assert.throws(() => decodeCursor("!!!not base64 at all!!!"), ValidationError);
  });

  it("names the field it refused, so the caller knows what to fix", () => {
    assert.throws(
      () => decodeCursor(Buffer.from("nonsense", "utf8").toString("base64url")),
      (error: unknown) =>
        error instanceof ValidationError && error.details?.field === "cursor",
    );
  });
});
