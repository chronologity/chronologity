import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import {
  capPerFacet,
  DEFAULT_CAPS,
  overFetchFor,
  type Facets,
} from "./discovery.diversity.js";
import { amplifiableStates } from "./discovery.ranking.js";
import { suppressesAmplification } from "../moderation/moderation.policy.js";
import type { ModerationState } from "@chronologity/contracts";

const candidate = (over: Partial<Facets> & { id?: string } = {}) => ({
  id: over.id ?? "c",
  authorUserId: over.authorUserId ?? "author-1",
  locationId: over.locationId,
  realWorldEventId: over.realWorldEventId,
});

describe("capPerFacet", () => {
  it("returns an empty page for no candidates", () => {
    assert.deepEqual(capPerFacet([], 10), []);
  });

  it("keeps everything when nothing is concentrated", () => {
    const candidates = [
      candidate({ id: "a", authorUserId: "one" }),
      candidate({ id: "b", authorUserId: "two" }),
      candidate({ id: "c", authorUserId: "three" }),
    ];

    assert.deepEqual(capPerFacet(candidates, 10).map((c) => c.id), ["a", "b", "c"]);
  });

  it("preserves the order it was given", () => {
    // A cap, not a shuffle. The document warns against diversity operating as
    // an unexplained randomisation mechanism.
    const candidates = ["a", "b", "c", "d"].map((id, index) =>
      candidate({ id, authorUserId: `author-${index}` }),
    );

    assert.deepEqual(capPerFacet(candidates, 10).map((c) => c.id), ["a", "b", "c", "d"]);
  });

  it("stops one author filling a page", () => {
    const candidates = Array.from({ length: 10 }, (_, index) =>
      candidate({ id: `m${index}`, authorUserId: "prolific" }),
    );

    assert.equal(capPerFacet(candidates, 10).length, DEFAULT_CAPS.perAuthor);
  });

  it("stops one place filling a page", () => {
    const candidates = Array.from({ length: 10 }, (_, index) =>
      candidate({ id: `m${index}`, authorUserId: `author-${index}`, locationId: "somewhere" }),
    );

    assert.equal(capPerFacet(candidates, 10).length, DEFAULT_CAPS.perLocation);
  });

  it("stops one Event filling a page", () => {
    const candidates = Array.from({ length: 10 }, (_, index) =>
      candidate({
        id: `m${index}`,
        authorUserId: `author-${index}`,
        realWorldEventId: "one-event",
      }),
    );

    assert.equal(capPerFacet(candidates, 10).length, DEFAULT_CAPS.perRealWorldEvent);
  });

  it("lets a few from one author through rather than only one", () => {
    // Somebody who recorded a wedding from six angles has six Moments that
    // belong together. A cap of one would make Discovery incoherent in the name
    // of breadth.
    const candidates = Array.from({ length: 6 }, (_, index) =>
      candidate({ id: `m${index}`, authorUserId: "one" }),
    );

    assert.ok(capPerFacet(candidates, 10).length > 1);
  });

  it("caps a candidate with no place only by its author", () => {
    const candidates = Array.from({ length: 6 }, (_, index) =>
      candidate({ id: `m${index}`, authorUserId: `author-${index}` }),
    );

    // The absence of a facet is not a reason to exclude: Moments without a
    // recorded place are ordinary rather than exceptional.
    assert.equal(capPerFacet(candidates, 10).length, 6);
  });

  it("honours the page size before the caps are reached", () => {
    const candidates = Array.from({ length: 20 }, (_, index) =>
      candidate({ id: `m${index}`, authorUserId: `author-${index}` }),
    );

    assert.equal(capPerFacet(candidates, 5).length, 5);
  });

  it("returns a short page rather than a concentrated one", () => {
    const candidates = Array.from({ length: 20 }, (_, index) =>
      candidate({ id: `m${index}`, authorUserId: "one" }),
    );

    // Honest: the cap discarded the rest, and a short page says so.
    assert.equal(capPerFacet(candidates, 20).length, DEFAULT_CAPS.perAuthor);
  });

  it("returns nothing when the caps are zero", () => {
    const candidates = [candidate({ id: "a" })];

    assert.deepEqual(
      capPerFacet(candidates, 10, { perAuthor: 0, perLocation: 0, perRealWorldEvent: 0 }),
      [],
    );
  });
});

describe("overFetchFor", () => {
  it("asks for more than a page, because the caps discard some", () => {
    assert.ok(overFetchFor(20) > 20);
  });

  it("stays bounded however large the page", () => {
    // A sparse page is preferable to an unbounded scan.
    assert.ok(overFetchFor(50) <= 200);
  });
});

describe("amplifiableStates", () => {
  it("agrees with the policy, state by state", () => {
    // The SQL twin of `suppressesAmplification`. It exists twice because a set
    // query cannot call a per-row function without breaking pagination, and
    // this is what stops the two drifting apart.
    const states: ModerationState[] = [
      "allowed",
      "warned",
      "restricted_from_amplification",
      "restricted_to_authorized_audience",
      "age_restricted",
      "temporarily_unavailable",
      "removed",
    ];

    for (const state of states) {
      assert.equal(
        amplifiableStates().includes(state),
        !suppressesAmplification(state),
        state,
      );
    }
  });

  it("permits only two states", () => {
    assert.deepEqual([...amplifiableStates()].sort(), ["allowed", "warned"]);
  });
});

describe("the discovery ranking module", () => {
  it("imports nothing at all", () => {
    // Engagement must not dominate Discovery, and the only durable form of that
    // is being unable to reach a reaction count.
    const source = readFileSync(new URL("./discovery.ranking.ts", import.meta.url), "utf8");

    assert.equal(/^\s*import\s/mu.test(source), false);
  });

  it("mentions no engagement concept", () => {
    const source = readFileSync(new URL("./discovery.ranking.ts", import.meta.url), "utf8")
      .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
      .replaceAll(/\/\/.*$/gmu, "");

    for (const word of ["reaction", "comment", "view", "popular", "trending", "engagement"]) {
      assert.equal(source.toLowerCase().includes(word), false, word);
    }
  });
});
