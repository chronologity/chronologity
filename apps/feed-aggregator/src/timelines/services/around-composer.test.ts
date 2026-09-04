import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { viewSpecificationSchema } from "@chronologity/contracts";
import { describe, it } from "vitest";
import { reading } from "../../testing/timeline-context.js";
import { aroundFrom, nowhere } from "./around-composer.js";
import type { ResolvedAnchor } from "./jump-anchor.js";

/**
 * Assembling a landing out of two pages.
 *
 * Two claims are settled here and nowhere else. **What was at the position** is
 * read from the older page's first entry, and is null whenever that entry is not
 * actually the anchor — which is what keeps `timeline.md:367`'s promise that a
 * position is preserved rather than redefined as whichever Moment was nearest.
 * And **each page answers the other's near side**, because a jump reaches
 * neither half by a cursor while both plainly have history beside them.
 */

const PERSON = randomUUID();
const AUTHOR = randomUUID();

const view = viewSpecificationSchema.parse({ context: { type: "person", id: PERSON } });

const anchorAt = (iso: string, over: Partial<ResolvedAnchor> = {}): ResolvedAnchor => ({
  instant: new Date(iso),
  momentId: undefined,
  authorUserId: undefined,
  scope: { type: "person", id: PERSON },
  reason: "INSTANT",
  ...over,
});

const slice = (rows: ReturnType<typeof reading>[], more = false) => ({ rows, more });

describe("what was at the position", () => {
  it("is the first entry of the older page when it sits exactly there", () => {
    const at = reading(AUTHOR, { occurred_at: "2014-05-01 00:00:00.000" });
    const around = aroundFrom(
      anchorAt("2014-05-01T00:00:00.000Z"),
      view,
      slice([at, reading(AUTHOR, { occurred_at: "2013-01-01 00:00:00.000" })]),
      slice([]),
    );

    assert.equal(around.at?.momentId, at.moment_id);
  });

  it("is null when the nearest thing is merely nearby", () => {
    // The whole of `timeline.md:367`. Somebody who jumps to a June nothing
    // happened in has landed in June, not on the February before it.
    const around = aroundFrom(
      anchorAt("2021-06-01T00:00:00.000Z"),
      view,
      slice([reading(AUTHOR, { occurred_at: "2021-02-14 00:00:00.000" })]),
      slice([reading(AUTHOR, { occurred_at: "2021-11-03 00:00:00.000" })]),
    );

    assert.equal(around.at, null);
    assert.equal(around.anchoredAt?.toISOString(), "2021-06-01T00:00:00.000Z");
  });

  it("is null when nothing came before the position at all", () => {
    const around = aroundFrom(
      anchorAt("2021-06-01T00:00:00.000Z"),
      view,
      slice([]),
      slice([reading(AUTHOR, { occurred_at: "2021-11-03 00:00:00.000" })]),
    );

    assert.equal(around.at, null);
  });

  it("stays in the older page rather than being lifted out of it", () => {
    // Removing it would shorten a page by one depending on whether the
    // destination happened to be a member — a page short for a reason its size
    // cannot explain.
    const at = reading(AUTHOR, { occurred_at: "2014-05-01 00:00:00.000" });
    const around = aroundFrom(anchorAt("2014-05-01T00:00:00.000Z"), view, slice([at]), slice([]));

    assert.equal(around.older.edges.length, 1);
    assert.equal(around.older.edges[0]?.node.momentId, at.moment_id);
  });

  it("matches a named Moment by identity, not by when it happened", () => {
    // Two Moments can share an instant. Landing on the wrong one would be
    // invisible in the answer.
    const asked = reading(AUTHOR, { occurred_at: "2014-05-01 00:00:00.000" });
    const other = reading(AUTHOR, { occurred_at: "2014-05-01 00:00:00.000" });
    const around = aroundFrom(
      anchorAt("2014-05-01T00:00:00.000Z", { momentId: asked.moment_id, reason: "MOMENT" }),
      view,
      slice([other, asked]),
      slice([]),
    );

    assert.equal(around.at, null);
  });

  it("finds a named Moment when it is the one that came back first", () => {
    const asked = reading(AUTHOR, { occurred_at: "2014-05-01 00:00:00.000" });
    const around = aroundFrom(
      anchorAt("2014-05-01T00:00:00.000Z", { momentId: asked.moment_id, reason: "MOMENT" }),
      view,
      slice([asked]),
      slice([]),
    );

    assert.equal(around.at?.momentId, asked.moment_id);
  });
});

describe("each page answering the other's near side", () => {
  it("says there is history after the landing when the newer page holds some", () => {
    const around = aroundFrom(
      anchorAt("2014-05-01T00:00:00.000Z"),
      view,
      slice([reading(AUTHOR)]),
      slice([reading(AUTHOR, { occurred_at: "2015-01-01 00:00:00.000" })]),
    );

    assert.equal(around.older.pageInfo.hasPreviousPage, true);
    assert.equal(around.newer.pageInfo.hasNextPage, true);
  });

  it("says there is none when the other half is empty", () => {
    const around = aroundFrom(
      anchorAt("2014-05-01T00:00:00.000Z"),
      view,
      slice([reading(AUTHOR)]),
      slice([]),
    );

    assert.equal(around.older.pageInfo.hasPreviousPage, false);
  });

  it("keeps each page's own far side from its own read", () => {
    const around = aroundFrom(
      anchorAt("2014-05-01T00:00:00.000Z"),
      view,
      slice([reading(AUTHOR)], true),
      slice([reading(AUTHOR, { occurred_at: "2015-01-01 00:00:00.000" })], false),
    );

    assert.equal(around.older.pageInfo.hasNextPage, true);
    assert.equal(around.newer.pageInfo.hasPreviousPage, false);
  });
});

describe("saying where it landed", () => {
  it("gives one scope, and the pages agree with it", () => {
    const around = aroundFrom(
      anchorAt("2014-05-01T00:00:00.000Z"),
      view,
      slice([reading(AUTHOR)]),
      slice([]),
    );

    assert.deepEqual(around.scope, { type: "PERSON", id: PERSON });
    assert.deepEqual(around.older.scope, around.scope);
    assert.deepEqual(around.newer.scope, around.scope);
  });

  it("reports the reason the destination was named", () => {
    const around = aroundFrom(
      anchorAt("2014-05-01T00:00:00.000Z", { reason: "CAUSAL_RELATIONSHIP" }),
      view,
      slice([]),
      slice([]),
    );

    assert.equal(around.reason, "CAUSAL_RELATIONSHIP");
  });
});

describe("a destination that cannot be reached", () => {
  it("is a position of nothing rather than a refusal", () => {
    // One answer for three reasons — never there, not yours to see, on a
    // Timeline you may not open. Telling them apart would say something was
    // there.
    const around = nowhere({ type: "person", id: PERSON }, "MOMENT");

    assert.equal(around.anchoredAt, null);
    assert.equal(around.at, null);
    assert.deepEqual(around.older.edges, []);
    assert.deepEqual(around.newer.edges, []);
    assert.equal(around.older.pageInfo.hasNextPage, false);
    assert.equal(around.older.pageInfo.hasPreviousPage, false);
    assert.equal(around.older.pageInfo.startCursor, null);
    assert.equal(around.older.pageInfo.endCursor, null);
  });

  it("still says what was asked about, which the client already knows", () => {
    const around = nowhere({ type: "location", id: PERSON }, "LOCATION");

    assert.deepEqual(around.scope, { type: "LOCATION", id: PERSON });
    assert.equal(around.reason, "LOCATION");
  });
});
