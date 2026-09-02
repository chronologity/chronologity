import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { normalizePhone } from "./normalize-phone.js";

describe("normalizePhone", () => {
  it("reduces the ways one number is written to a single form", () => {
    const spellings = [
      "+1 (212) 555-0184",
      "+12125550184",
      "+1 212 555 0184",
      "  +1-212-555-0184  ",
    ];

    const normalized = spellings.map(normalizePhone);

    // The whole point. Two spellings reaching two rows would be one person with
    // two accounts, or a claim that quietly failed to collide with itself.
    assert.deepEqual(normalized, Array.from(spellings, () => "+12125550184"));
  });

  it("keeps numbers from different countries apart", () => {
    const uk = normalizePhone("+44 20 7946 0958");
    const us = normalizePhone("+1 212 555 0184");

    assert.equal(uk, "+442079460958");
    assert.notEqual(uk, us);
  });

  it("refuses a number with no country", () => {
    // Guessing a country would resolve an ambiguous number to a real telephone
    // somewhere, which is worse than refusing it.
    assert.equal(normalizePhone("212 555 0184"), undefined);
    assert.equal(normalizePhone("07946 0958"), undefined);
  });

  it("refuses something that is not a number at all", () => {
    assert.equal(normalizePhone("+not a number"), undefined);
    assert.equal(normalizePhone(""), undefined);
    assert.equal(normalizePhone("+"), undefined);
  });

  it("refuses a number that could not be dialled", () => {
    assert.equal(normalizePhone("+1 212 555"), undefined);
    assert.equal(normalizePhone("+1 2125550184999999"), undefined);
  });

  it("refuses an unassigned country calling code", () => {
    assert.equal(normalizePhone("+999 1234567890"), undefined);
  });
});
