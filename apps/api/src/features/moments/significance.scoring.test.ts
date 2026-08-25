import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import {
  ALGORITHM_VERSION,
  scoreCausal,
  scoreCollective,
  scoreEvent,
  scoreEvidentiary,
  scorePersonal,
  scoreRetrospective,
  scoreStructural,
  scoreTemporal,
} from "./significance.scoring.js";

describe("scoreCausal", () => {
  it("scores nothing for a Moment nothing descends from", () => {
    assert.equal(scoreCausal({ descendantCount: 0, ancestorCount: 0 }), 0);
  });

  it("counts everything downstream, not only what it points at", () => {
    // The document's own example: in A -> B -> C -> D the first Moment has one
    // outgoing edge and the whole chain depends on it. Invariant 7 forbids
    // reducing this to out-degree.
    const headOfChain = scoreCausal({ descendantCount: 3, ancestorCount: 0 });
    const middleOfChain = scoreCausal({ descendantCount: 1, ancestorCount: 2 });

    assert.ok(headOfChain > middleOfChain);
  });

  it("does not let being caused by things raise it", () => {
    const consequential = scoreCausal({ descendantCount: 2, ancestorCount: 0 });
    const merelyCaused = scoreCausal({ descendantCount: 2, ancestorCount: 9 });

    assert.equal(consequential, merelyCaused);
  });
});

describe("scoreStructural", () => {
  it("scores nothing for a Moment joined to nothing", () => {
    assert.equal(
      scoreStructural({ incomingEdges: 0, outgoingEdges: 0, contextCount: 0 }),
      0,
    );
  });

  it("rewards bridging two stretches of history", () => {
    const bridge = scoreStructural({ incomingEdges: 1, outgoingEdges: 1, contextCount: 0 });
    const endOfChain = scoreStructural({ incomingEdges: 3, outgoingEdges: 0, contextCount: 0 });

    // A convergence point joins history that would otherwise be separate.
    // Merely being busy at one end does not.
    assert.ok(bridge > endOfChain);
  });

  it("counts the contexts it touches", () => {
    const oneContext = scoreStructural({ incomingEdges: 0, outgoingEdges: 0, contextCount: 1 });
    const three = scoreStructural({ incomingEdges: 0, outgoingEdges: 0, contextCount: 3 });

    assert.ok(three > oneContext);
  });
});

describe("scoreTemporal", () => {
  it("scores nothing for a Moment in the middle of everything", () => {
    assert.equal(
      scoreTemporal({ boundsRecord: false, boundsPlace: false, boundsEvent: false }),
      0,
    );
  });

  it("scores a boundary for each stretch of history it edges", () => {
    assert.equal(
      scoreTemporal({ boundsRecord: true, boundsPlace: false, boundsEvent: false }),
      1,
    );
    assert.equal(
      scoreTemporal({ boundsRecord: true, boundsPlace: true, boundsEvent: true }),
      3,
    );
  });

  it("treats the first at a place as a boundary on its own", () => {
    const firstAtAPlace = scoreTemporal({
      boundsRecord: false,
      boundsPlace: true,
      boundsEvent: false,
    });

    assert.ok(firstAtAPlace > 0);
  });
});

describe("scorePersonal", () => {
  it("is binary, because the mark is", () => {
    assert.equal(scorePersonal(true), 1);
    assert.equal(scorePersonal(false), 0);
  });
});

describe("scoreCollective", () => {
  it("scores nothing when nobody else was there", () => {
    // Convergence with nobody is not convergence. One person recording forty
    // times is still one perspective.
    assert.equal(scoreCollective({ distinctAuthors: 1 }), 0);
    assert.equal(scoreCollective({ distinctAuthors: 0 }), 0);
  });

  it("rises with separate people, never with volume", () => {
    assert.equal(scoreCollective({ distinctAuthors: 2 }), 1);
    assert.equal(scoreCollective({ distinctAuthors: 5 }), 4);
  });
});

describe("scoreEvent", () => {
  it("scores nothing for a Moment tied to no Event", () => {
    assert.equal(scoreEvent({ momentsInEvent: 0, isOnlyRecord: false }), 0);
  });

  it("weighs the only record of an occurrence above one of many", () => {
    const only = scoreEvent({ momentsInEvent: 1, isOnlyRecord: true });
    const oneOfMany = scoreEvent({ momentsInEvent: 200, isOnlyRecord: false });

    // Invariant 15: Moments tied to the same Event may differ in significance.
    // The one photograph anybody has carries the occurrence entirely.
    assert.ok(only > oneOfMany);
  });
});

describe("scoreEvidentiary", () => {
  it("scores nothing for an uncorroborated Moment", () => {
    assert.equal(scoreEvidentiary({ corroborations: 0, contradictions: 0 }), 0);
  });

  it("rises with independent accounts of the same occurrence", () => {
    assert.equal(scoreEvidentiary({ corroborations: 3, contradictions: 0 }), 3);
  });

  it("withholds corroboration where an account is disputed", () => {
    assert.equal(scoreEvidentiary({ corroborations: 3, contradictions: 1 }), 2);
  });

  it("never scores below nothing, however contested", () => {
    // Being argued about is not evidence either way. Invariant 16: evidentiary
    // significance does not establish truth.
    assert.equal(scoreEvidentiary({ corroborations: 0, contradictions: 5 }), 0);
  });
});

describe("scoreRetrospective", () => {
  it("scores nothing when later history changed nothing", () => {
    assert.equal(scoreRetrospective(4, 4), 0);
  });

  it("measures how far a Moment has risen since first assessed", () => {
    assert.equal(scoreRetrospective(9, 2), 7);
  });

  it("scores nothing for a Moment that has fallen", () => {
    // Losing descendants is not acquiring negative retrospective significance.
    assert.equal(scoreRetrospective(1, 6), 0);
  });

  it("scores nothing for a consequential Moment that was always known to be", () => {
    const alwaysConsequential = scoreRetrospective(20, 20);

    assert.equal(alwaysConsequential, 0);
  });
});

describe("the algorithm version", () => {
  it("names itself, so evolution can be told from historical change", () => {
    assert.match(ALGORITHM_VERSION, /^significance-v\d+$/);
  });
});

describe("engagement is architecturally separable", () => {
  it("reaches nothing belonging to reactions or comments", async () => {
    const source = await readFile(
      fileURLToPath(new URL("./significance.scoring.ts", import.meta.url)),
      "utf8",
    );
    const imports = [...source.matchAll(/^import .*from "([^"]+)"/gm)].map(
      (match) => match[1] ?? "",
    );

    // Comments are stripped first: this module's own prose explains that it
    // takes no reaction or comment count, and that sentence is not a dependency.
    // What matters is whether the code can reach them.
    const code = source
      .replaceAll(/\/\*[\s\S]*?\*\//g, "")
      .replaceAll(/^\s*\/\/.*$/gm, "");

    // The architecture constraints ask that engagement stay separable "so that a
    // future optimization cannot casually turn reaction or view counts into
    // historical importance". Intention is not separation; not being able to
    // reach them is.
    assert.deepEqual(imports, []);
    assert.doesNotMatch(code, /reaction|comment/i);
  });
});
