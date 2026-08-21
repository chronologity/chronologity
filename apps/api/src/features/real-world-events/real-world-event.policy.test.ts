import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  checkOccurrence,
  describeOccurrenceRejection,
  distinctAliases,
  distinctLocationIds,
} from "./real-world-event.policy.js";

const at = (iso: string): string => new Date(iso).toISOString();

describe("checking an occurrence", () => {
  it("accepts an interval that ends after it starts", () => {
    const rejection = checkOccurrence({
      start: at("2026-11-20T09:00:00Z"),
      end: at("2026-11-22T18:00:00Z"),
      precision: "day",
    });

    assert.equal(rejection, undefined);
  });

  it("accepts an instant whose ends are the same moment", () => {
    const moment = at("2026-11-20T09:00:00Z");

    assert.equal(checkOccurrence({ start: moment, end: moment, precision: "instant" }), undefined);
  });

  it("accepts a coarse precision whose ends are the same moment", () => {
    const moment = at("2026-11-20T09:00:00Z");

    // Only `instant` claims a point. A caller who knows the day and records a
    // zero-width interval within it has said nothing contradictory.
    assert.equal(checkOccurrence({ start: moment, end: moment, precision: "year" }), undefined);
  });

  it("refuses an interval that ends before it starts", () => {
    const rejection = checkOccurrence({
      start: at("2026-11-22T18:00:00Z"),
      end: at("2026-11-20T09:00:00Z"),
      precision: "day",
    });

    assert.equal(rejection, "interval_reversed");
  });

  it("refuses an instant spanning two different moments", () => {
    const rejection = checkOccurrence({
      start: at("2026-11-20T09:00:00Z"),
      end: at("2026-11-20T11:00:00Z"),
      precision: "instant",
    });

    // Claiming an instant while giving a two-hour window claims a precision
    // nobody has.
    assert.equal(rejection, "instant_not_a_point");
  });

  it("reports a reversed interval before it considers precision", () => {
    const rejection = checkOccurrence({
      start: at("2026-11-20T11:00:00Z"),
      end: at("2026-11-20T09:00:00Z"),
      precision: "instant",
    });

    // Both rules are broken. The reversal is the one worth saying: it is the
    // reason the other cannot be evaluated meaningfully.
    assert.equal(rejection, "interval_reversed");
  });
});

describe("describing why an occurrence was refused", () => {
  it("explains a reversed interval", () => {
    assert.equal(
      describeOccurrenceRejection("interval_reversed"),
      "An occurrence cannot end before it starts",
    );
  });

  it("explains an instant that is not a point", () => {
    assert.equal(
      describeOccurrenceRejection("instant_not_a_point"),
      "An occurrence known to the instant must start and end at the same moment",
    );
  });
});

describe("reducing aliases", () => {
  it("keeps nothing when none were given", () => {
    assert.deepEqual(distinctAliases("Anime NYC 2026", undefined), []);
  });

  it("keeps the ones given, trimmed", () => {
    assert.deepEqual(distinctAliases("Anime NYC 2026", ["  Anime NYC  ", "ANYC"]), [
      "Anime NYC",
      "ANYC",
    ]);
  });

  it("drops an alias equal to the name", () => {
    // Storing it would present one string twice as though it were two pieces
    // of information.
    assert.deepEqual(distinctAliases("Anime NYC 2026", ["Anime NYC 2026", "ANYC"]), ["ANYC"]);
  });

  it("drops an alias equal to the name once whitespace is ignored", () => {
    assert.deepEqual(distinctAliases("  Anime NYC 2026  ", ["Anime NYC 2026"]), []);
  });

  it("drops repeats, keeping the first", () => {
    assert.deepEqual(distinctAliases("Anime NYC 2026", ["ANYC", "ANYC"]), ["ANYC"]);
  });

  it("drops blanks and whitespace-only entries", () => {
    assert.deepEqual(distinctAliases("Anime NYC 2026", ["", "   ", "ANYC"]), ["ANYC"]);
  });
});

describe("reducing places", () => {
  it("keeps nothing when none were given", () => {
    assert.deepEqual(distinctLocationIds(undefined), []);
  });

  it("keeps the order they were given in", () => {
    assert.deepEqual(distinctLocationIds(["b", "a", "c"]), ["b", "a", "c"]);
  });

  it("drops repeats, keeping the first", () => {
    assert.deepEqual(distinctLocationIds(["a", "b", "a"]), ["a", "b"]);
  });
});
