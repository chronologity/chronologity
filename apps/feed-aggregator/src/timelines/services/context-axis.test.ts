import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import type { ContextRow } from "../../read-models/clickhouse/context-axis-read-model.js";
import type { NamedContext } from "../../read-models/postgres/context-name-read-model.js";
import { axisFor, edgesFor } from "./context-axis.js";

/**
 * Rows and names as a stretch of the axis.
 *
 * The assertion that matters is what happens to a candidate the naming read did
 * not confirm: it is dropped, not named emptily. For a place that means some
 * Moment tying it here withheld where it happened, and a blank entry would still
 * say something is there.
 */

const PLACE = randomUUID();
const OCCASION = randomUUID();

const row = (over: Partial<ContextRow> = {}): ContextRow => ({
  context_type: "real_world_event",
  context_id: OCCASION,
  shared_moments: 3,
  latest: "2026-05-01 12:00:00.000",
  ...over,
});

const named = (...contexts: NamedContext[]): Map<string, NamedContext> =>
  new Map(contexts.map((one) => [`${one.contextType}:${one.contextId}`, one]));

describe("turning rows into somewhere to go", () => {
  it("hands back a scope ready to be used as a Timeline's", () => {
    const edges = edgesFor(
      [row()],
      named({ contextType: "real_world_event", contextId: OCCASION, name: "Anime NYC" }),
      "shared",
    );

    assert.deepEqual(edges[0]?.node.scope, { type: "REAL_WORLD_EVENT", id: OCCASION });
    assert.equal(edges[0]?.node.name, "Anime NYC");
  });

  it("says which tier a context is in", () => {
    const one = named({ contextType: "real_world_event", contextId: OCCASION, name: "x" });

    assert.equal(edgesFor([row()], one, "shared")[0]?.node.adjacency, "SHARED_HISTORY");
    assert.equal(edgesFor([row()], one, "period")[0]?.node.adjacency, "SAME_PERIOD");
  });

  it("drops a candidate the naming read did not confirm", () => {
    // A place whose supporting Moments all withheld where they happened, or an
    // occasion this reader may not know exists.
    assert.deepEqual(edgesFor([row()], named(), "shared"), []);
  });

  it("keeps the confirmed ones when only some were dropped", () => {
    const rows = [row(), row({ context_type: "location", context_id: PLACE })];
    const edges = edgesFor(
      rows,
      named({ contextType: "location", contextId: PLACE, name: "The Garden" }),
      "shared",
    );

    assert.deepEqual(
      edges.map((edge) => edge.node.name),
      ["The Garden"],
    );
  });

  it("keeps the order the axis found them in, not the naming read's", () => {
    // The naming read answers in whatever order it likes; the ordering is the
    // axis's and has to survive being joined to it.
    const first = row({ context_type: "location", context_id: PLACE, shared_moments: 9 });
    const second = row();
    const edges = edgesFor(
      [first, second],
      named(
        { contextType: "real_world_event", contextId: OCCASION, name: "second" },
        { contextType: "location", contextId: PLACE, name: "first" },
      ),
      "shared",
    );

    assert.deepEqual(
      edges.map((edge) => edge.node.name),
      ["first", "second"],
    );
  });

  it("puts the whole sort key in each cursor", () => {
    const edges = edgesFor(
      [row()],
      named({ contextType: "real_world_event", contextId: OCCASION, name: "x" }),
      "shared",
    );

    assert.deepEqual(edges[0]?.cursor, {
      kind: "context",
      tier: "shared",
      shared: 3,
      latest: new Date("2026-05-01T12:00:00.000Z"),
      contextType: "real_world_event",
      contextId: OCCASION,
    });
  });
});

describe("a stretch of the axis", () => {
  const edge = () =>
    edgesFor([row()], named({ contextType: "real_world_event", contextId: OCCASION, name: "x" }), "shared");

  it("takes a cursor from each end", () => {
    const axis = axisFor(edge(), false, false);

    assert.notEqual(axis.pageInfo.startCursor, null);
    assert.notEqual(axis.pageInfo.endCursor, null);
  });

  it("gives an empty stretch no ends", () => {
    const axis = axisFor([], false, false);

    assert.equal(axis.pageInfo.startCursor, null);
    assert.equal(axis.pageInfo.endCursor, null);
  });

  it("says the axis continues when it does", () => {
    assert.equal(axisFor(edge(), true, false).pageInfo.hasNextPage, true);
  });

  it("says there is something behind a stretch reached from a cursor", () => {
    assert.equal(axisFor(edge(), false, true).pageInfo.hasPreviousPage, true);
  });
});
