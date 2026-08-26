import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { SearchRequest } from "@chronologity/contracts";
import { interpret } from "./search.query.js";

const request = (over: Partial<SearchRequest> = {}): SearchRequest =>
  ({ sort: "relevance", limit: 20, ...over }) as SearchRequest;

describe("interpret", () => {
  it("splits the words", () => {
    assert.deepEqual(interpret(request({ q: "the summer everything changed" })).terms, [
      "the",
      "summer",
      "everything",
      "changed",
    ]);
  });

  it("lowercases the words but keeps the phrase as typed", () => {
    const query = interpret(request({ q: "The Great War" }));

    assert.deepEqual(query.terms, ["the", "great", "war"]);
    assert.equal(query.phrase, "The Great War");
  });

  it("collapses runs of whitespace", () => {
    assert.deepEqual(interpret(request({ q: "one   two" })).terms, ["one", "two"]);
  });

  it("has no words when only filters were given", () => {
    const query = interpret(request({ creator: "someone" }));

    assert.deepEqual(query.terms, []);
    assert.equal(query.phrase, "");
  });

  it("drops a word longer than anybody types", () => {
    assert.deepEqual(interpret(request({ q: "x".repeat(100) })).terms, []);
  });

  it("honours a bounded number of words", () => {
    const query = interpret(request({ q: Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ") }));

    assert.equal(query.terms.length, 12);
  });

  it("chooses a modest radius when a position comes without one", () => {
    // "Near here" should mean near, not the whole world. A kilometre is
    // answered at neighbourhood granularity rather than region: cells are
    // chosen to cover the radius, so a small radius never reaches for the
    // coarsest tier.
    assert.notEqual(interpret(request({ lat: 38.7, lon: -9.1 })).near?.tier, "region");
  });

  it("chooses the tier the radius can honestly be answered at", () => {
    assert.equal(interpret(request({ lat: 38.7, lon: -9.1, radius: 5_000 })).near?.tier, "neighbourhood");
    assert.equal(interpret(request({ lat: 38.7, lon: -9.1, radius: 500_000 })).near?.tier, "region");
  });

  it("has no position when none was given", () => {
    assert.equal(interpret(request({ q: "anything" })).near, undefined);
  });
});

describe("the fingerprint", () => {
  it("is the same for the same search asked twice", () => {
    assert.equal(
      interpret(request({ q: "woodstock" })).fingerprint,
      interpret(request({ q: "woodstock" })).fingerprint,
    );
  });

  it("changes when the words change", () => {
    assert.notEqual(
      interpret(request({ q: "woodstock" })).fingerprint,
      interpret(request({ q: "glastonbury" })).fingerprint,
    );
  });

  it("changes when the sort changes", () => {
    // A cursor from a relevance ordering must not be honoured against a
    // chronological one.
    assert.notEqual(
      interpret(request({ q: "x", sort: "relevance" })).fingerprint,
      interpret(request({ q: "x", sort: "occurrence_new" })).fingerprint,
    );
  });

  it("changes when a filter is added", () => {
    assert.notEqual(
      interpret(request({ q: "x" })).fingerprint,
      interpret(request({ q: "x", creator: "someone" })).fingerprint,
    );
  });

  it("changes when the entity type changes", () => {
    assert.notEqual(
      interpret(request({ q: "x", type: "moment" })).fingerprint,
      interpret(request({ q: "x", type: "event" })).fingerprint,
    );
  });

  it("changes when the temporal window changes", () => {
    assert.notEqual(
      interpret(request({ q: "x", from: "1998-01-01T00:00:00.000Z" })).fingerprint,
      interpret(request({ q: "x", from: "1999-01-01T00:00:00.000Z" })).fingerprint,
    );
  });

  it("changes when the position changes", () => {
    assert.notEqual(
      interpret(request({ lat: 38.7, lon: -9.1 })).fingerprint,
      interpret(request({ lat: 51.5, lon: -0.1 })).fingerprint,
    );
  });

  it("does not change when only the page size changes", () => {
    // Asking for twenty and then ten of the same search is the same search.
    assert.equal(
      interpret(request({ q: "x", limit: 20 })).fingerprint,
      interpret(request({ q: "x", limit: 10 })).fingerprint,
    );
  });
});
