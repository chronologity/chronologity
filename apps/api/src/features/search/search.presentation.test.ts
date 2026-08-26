import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { matchReasons, snippet, type MatchContext } from "./search.presentation.js";

const context = (over: Partial<MatchContext> = {}): MatchContext => ({
  title: "The First World War",
  aliases: "The Great War",
  body: "",
  phrase: "",
  terms: [],
  hadTemporalFilter: false,
  hadProximityFilter: false,
  hadCreatorFilter: false,
  hadEventFilter: false,
  hadLocationFilter: false,
  ...over,
});

describe("snippet", () => {
  it("returns nothing for empty text", () => {
    assert.equal(snippet("", ["anything"]), null);
    assert.equal(snippet("   ", ["anything"]), null);
  });

  it("returns short text whole", () => {
    assert.equal(snippet("A short caption", ["short"]), "A short caption");
  });

  it("centres on the first match in long text", () => {
    const text = `${"x".repeat(400)} needle ${"y".repeat(400)}`;

    assert.ok(snippet(text, ["needle"])?.includes("needle"));
  });

  it("marks that it cut the beginning", () => {
    const text = `${"x".repeat(400)} needle`;

    assert.ok(snippet(text, ["needle"])?.startsWith("…"));
  });

  it("marks that it cut the end", () => {
    const text = `needle ${"y".repeat(400)}`;

    assert.ok(snippet(text, ["needle"])?.endsWith("…"));
  });

  it("does not mark a cut it did not make", () => {
    const snipped = snippet("A short caption", ["short"]);

    assert.equal(snipped?.startsWith("…"), false);
    assert.equal(snipped?.endsWith("…"), false);
  });

  it("opens the text when the match was somewhere else", () => {
    // Matching on a title or an alias is why this row came back; the body has
    // no match to centre on, so the opening is what a reader gets.
    const snipped = snippet("A caption with nothing matching", ["woodstock"]);

    assert.ok(snipped?.startsWith("A caption"));
  });

  it("stays bounded whatever it is given", () => {
    const snipped = snippet("z".repeat(10_000), []);

    assert.ok((snipped?.length ?? 0) <= 200);
  });

  it("invents no words", () => {
    // The ellipsis marks removal. It never stands in for text nobody wrote.
    const text = "one two three";

    assert.equal(snippet(text, ["two"])?.replaceAll("…", ""), text);
  });
});

describe("matchReasons", () => {
  it("names an exact title match", () => {
    const reasons = matchReasons(
      context({ phrase: "the first world war", terms: ["the", "first", "world", "war"] }),
    );

    assert.ok(reasons.includes("exact_title_match"));
  });

  it("names a partial title match without calling it exact", () => {
    const reasons = matchReasons(context({ phrase: "world", terms: ["world"] }));

    assert.ok(reasons.includes("title_match"));
    assert.equal(reasons.includes("exact_title_match"), false);
  });

  it("names an alias match", () => {
    const reasons = matchReasons(context({ phrase: "great", terms: ["great"] }));

    assert.ok(reasons.includes("alias_match"));
  });

  it("names a body match", () => {
    const reasons = matchReasons(
      context({ body: "It rained all week", phrase: "rained", terms: ["rained"] }),
    );

    assert.ok(reasons.includes("caption_match"));
  });

  it("names each filter that was actually applied", () => {
    const reasons = matchReasons(
      context({
        hadTemporalFilter: true,
        hadProximityFilter: true,
        hadCreatorFilter: true,
        hadEventFilter: true,
        hadLocationFilter: true,
      }),
    );

    for (const reason of [
      "temporal_match",
      "proximity_match",
      "creator_match",
      "event_match",
      "location_match",
    ] as const) {
      assert.ok(reasons.includes(reason), reason);
    }
  });

  it("names no filter that was not applied", () => {
    const reasons = matchReasons(context({ phrase: "world", terms: ["world"] }));

    assert.equal(reasons.includes("temporal_match"), false);
    assert.equal(reasons.includes("proximity_match"), false);
  });

  it("never comes back empty", () => {
    // A near miss on spelling retrieves without any word appearing literally.
    // A result that cannot say why it is here is what the document warns
    // against, so the truthful minimum is why the store returned the row.
    const reasons = matchReasons(context({ phrase: "wrld", terms: ["wrld"] }));

    assert.ok(reasons.length > 0);
  });
});

describe("the ranking module", () => {
  it("imports nothing at all", () => {
    // Not a style rule. Engagement must stay separable "so that a future
    // optimization cannot casually turn reaction or view counts into
    // historical importance", and the only durable form of that is being
    // unable to reach one. The same construction the significance scoring uses.
    const source = readFileSync(
      new URL("./search.ranking.ts", import.meta.url),
      "utf8",
    );

    assert.equal(/^\s*import\s/mu.test(source), false);
  });

  it("mentions no engagement concept", () => {
    const source = readFileSync(new URL("./search.ranking.ts", import.meta.url), "utf8")
      .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
      .replaceAll(/\/\/.*$/gmu, "");

    for (const word of ["reaction", "comment", "view", "popular", "trending", "engagement"]) {
      assert.equal(source.toLowerCase().includes(word), false, word);
    }
  });
});
