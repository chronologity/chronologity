import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  chooseName,
  correctionFor,
  interpretPrefix,
  MINIMUM_PREFIX,
  type NamedCandidate,
} from "./search.suggest.js";

const candidate = (over: Partial<NamedCandidate> = {}): NamedCandidate => ({
  entityType: "event",
  entityId: "event-1",
  title: "The First World War",
  aliases: "",
  ...over,
});

describe("interpretPrefix", () => {
  it("reads a prefix long enough to answer", () => {
    assert.deepEqual(interpretPrefix("wood", 10), { prefix: "wood", limit: 10 });
  });

  it("lowercases what was typed", () => {
    assert.equal(interpretPrefix("WoodSTOCK", 10)?.prefix, "woodstock");
  });

  it("trims surrounding space", () => {
    assert.equal(interpretPrefix("  wood  ", 10)?.prefix, "wood");
  });

  it("answers nothing for a prefix below the floor", () => {
    // A single letter would list everything the asker may see, twenty-six
    // requests wide — which is the enumeration this surface is most exposed to.
    assert.equal(interpretPrefix("w", 10), undefined);
  });

  it("answers nothing for an empty prefix", () => {
    assert.equal(interpretPrefix("", 10), undefined);
    assert.equal(interpretPrefix("   ", 10), undefined);
  });

  it("answers at exactly the floor", () => {
    assert.notEqual(interpretPrefix("w".repeat(MINIMUM_PREFIX), 10), undefined);
  });

  it("bounds an absurdly long prefix rather than refusing it", () => {
    assert.equal(interpretPrefix("x".repeat(500), 10)?.prefix.length, 100);
  });

  it("carries the limit through", () => {
    assert.equal(interpretPrefix("wood", 3)?.limit, 3);
  });
});

describe("chooseName", () => {
  it("shows the title when the title matched", () => {
    const chosen = chooseName(candidate(), "the first");

    assert.equal(chosen.label, "The First World War");
    assert.equal(chosen.matchedOn, "title");
    assert.equal(chosen.title, undefined);
  });

  it("shows the alias when an alias matched, and says what it is", () => {
    // "The Great War" on its own looks like a different Event.
    const chosen = chooseName(candidate({ aliases: "TheGreatWar WWI" }), "thegreat");

    assert.equal(chosen.label, "TheGreatWar");
    assert.equal(chosen.matchedOn, "alias");
    assert.equal(chosen.title, "The First World War");
  });

  it("prefers the title when both would match", () => {
    const chosen = chooseName(
      candidate({ title: "Woodstock", aliases: "Woodstock-1969" }),
      "wood",
    );

    assert.equal(chosen.label, "Woodstock");
    assert.equal(chosen.matchedOn, "title");
  });

  it("picks the same alias every time when several match", () => {
    const names = candidate({ aliases: "warone wartwo warthree" });

    assert.equal(chooseName(names, "war").label, chooseName(names, "war").label);
    assert.equal(chooseName(names, "war").label, "warone");
  });

  it("falls back to the title when neither name starts with the prefix", () => {
    // A fuzzy hit: the store found it by similarity, so the closest honest
    // answer is what the thing is actually called.
    const chosen = chooseName(candidate(), "frist");

    assert.equal(chosen.label, "The First World War");
    assert.equal(chosen.matchedOn, "title");
  });

  it("ignores empty entries in the alias list", () => {
    const chosen = chooseName(candidate({ aliases: "  greatwar  " }), "great");

    assert.equal(chosen.label, "greatwar");
  });

  it("carries the identity through unchanged", () => {
    const chosen = chooseName(candidate({ entityType: "location", entityId: "l-1" }), "the");

    assert.equal(chosen.entityType, "location");
    assert.equal(chosen.entityId, "l-1");
  });
});

describe("correctionFor", () => {
  it("offers nothing when the search found something", () => {
    // A correction alongside results would suggest the results were wrong.
    assert.equal(correctionFor(3, ["Woodstock"]), undefined);
  });

  it("offers the nearest name when the search found nothing", () => {
    assert.equal(correctionFor(0, ["Woodstock", "Woodward"]), "Woodstock");
  });

  it("offers nothing when nothing close exists", () => {
    // A correction nobody can act on is noise, and inventing one would be
    // fabricating history.
    assert.equal(correctionFor(0, []), undefined);
  });

  it("offers nothing for an empty candidate", () => {
    assert.equal(correctionFor(0, [""]), undefined);
  });
});
