import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { NAMED_VIEWER, PositionalParameters } from "./placeholders.js";

/**
 * The seam that lets one rule serve two dialects.
 *
 * Small enough to look untestable and exactly where a silent failure would come
 * from: a token that numbers wrongly sends the Moment identifier where the rule
 * expects the Viewer, and that returns nothing rather than raising — which reads
 * precisely like a Moment somebody is not allowed to see.
 */

describe("binding by position", () => {
  it("numbers from one, in the order values were bound", () => {
    const bind = new PositionalParameters();

    assert.equal(bind.bind("a"), "$1");
    assert.equal(bind.bind("b"), "$2");
    assert.equal(bind.bind("c"), "$3");
  });

  it("keeps the values in the order their tokens were issued", () => {
    const bind = new PositionalParameters();

    bind.bind("viewer");
    bind.bind(true);
    bind.bind("moment");

    assert.deepEqual(bind.values, ["viewer", true, "moment"]);
  });

  it("gives the same value a fresh number each time it is bound", () => {
    // Deliberate. A caller that binds twice gets two parameters holding the
    // same thing, which PostgreSQL is content with — where reusing a token
    // silently would make the count of values disagree with the statement.
    const bind = new PositionalParameters();

    assert.equal(bind.bind("same"), "$1");
    assert.equal(bind.bind("same"), "$2");
    assert.deepEqual(bind.values, ["same", "same"]);
  });

  it("hands back a copy, so a caller cannot alter what a later bind numbers", () => {
    const bind = new PositionalParameters();

    bind.bind("first");
    const taken = bind.values as unknown[];
    taken.push("smuggled");

    assert.equal(bind.bind("second"), "$2");
    assert.deepEqual(bind.values, ["first", "second"]);
  });

  it("starts empty", () => {
    assert.deepEqual(new PositionalParameters().values, []);
  });
});

describe("binding by name", () => {
  it("spells the two facts the way TypeORM binds them", () => {
    assert.deepEqual(NAMED_VIEWER, {
      viewerUserId: ":viewerUserId",
      viewerIsAdult: ":viewerIsAdult",
    });
  });
});
