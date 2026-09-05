import assert from "node:assert/strict";
import { parse } from "graphql";
import { describe, it } from "vitest";
import { rootFieldOf } from "./metrics.plugin.js";

/**
 * What a request is counted as.
 *
 * The only decision in this module, and it is a privacy and cost decision
 * wearing a naming decision's clothes. A metric label with unbounded values is a
 * time series per value; a label the *client* chooses is a time series per value
 * the client feels like inventing. `observability.md:405` forbids that, and the
 * obvious reading of its own `operation` example — the GraphQL operation name —
 * is exactly the thing it forbids.
 */

describe("what a request is counted as", () => {
  it("counts a document by the field it asked for, not by what the client called it", async () => {
    // The same request, named twice. One time series, or two.
    const one = rootFieldOf(parse("query Timeline { timeline(view: {}) { edges { cursor } } }"));
    const other = rootFieldOf(
      parse("query SomethingElse { timeline(view: {}) { edges { cursor } } }"),
    );

    assert.equal(one, "timeline");
    assert.equal(other, "timeline");
  });

  it("cannot be made to invent a series", async () => {
    // The attack the rule exists for: a client naming every request uniquely
    // would otherwise create a metric series per request.
    const names = [1, 2, 3].map((n) => rootFieldOf(parse(`query Q${n} { viewer { userId } }`)));

    assert.deepEqual(names, ["viewer", "viewer", "viewer"]);
  });

  it("counts an anonymous document like any other", async () => {
    assert.equal(rootFieldOf(parse("{ viewer { userId } }")), "viewer");
  });

  it("takes the first root field when a document names several", async () => {
    // Not a set, and not every field: one request's cost belongs in one place,
    // and spreading it across everything it touched would count it more than
    // once. A document naming several is what the cost budget is for.
    assert.equal(
      rootFieldOf(parse("{ viewer { userId } timelineHead(view: {}) { __typename } }")),
      "viewer",
    );
  });

  it("says `other` rather than throwing when there is no field to name", async () => {
    // A fragment-only document is valid to parse and selects nothing. Counting
    // is not the place to discover that.
    assert.equal(rootFieldOf(parse("fragment F on Moment { momentId }")), "other");
  });
});
