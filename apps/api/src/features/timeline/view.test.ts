import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { viewSpecificationSchema, type ViewSpecification } from "@chronologity/contracts";
import { narrowingFor, narrowingSql, resolveRange } from "./view.js";

/**
 * Turning a perspective on history into what the projection needs.
 *
 * The rolling-range cases matter most. A range resolved at the wrong moment
 * still returns Moments and still looks right; what it loses is that the view
 * meant "recently" rather than "those particular dates", and nothing downstream
 * could tell afterwards.
 */

const PERSON = randomUUID();
const PLACE = randomUUID();

const view = (over: Record<string, unknown> = {}): ViewSpecification =>
  viewSpecificationSchema.parse({ context: { type: "person", id: PERSON }, ...over });

describe("resolveRange", () => {
  it("leaves a fixed range exactly where it was", () => {
    const range = { kind: "fixed", from: "1969-07-16T00:00:00.000Z", to: "1969-07-24T00:00:00.000Z" } as const;

    const first = resolveRange(range, new Date("2026-01-01T00:00:00.000Z"));
    const later = resolveRange(range, new Date("2036-01-01T00:00:00.000Z"));

    assert.deepEqual(first, later, "a fixed range moved");
    assert.equal(first?.from.toISOString(), "1969-07-16T00:00:00.000Z");
  });

  it("moves a rolling range with the day it is opened on", () => {
    // The property the whole distinction exists for. "The last thirty days"
    // saved in June and opened in December must mean December's thirty days.
    const range = { kind: "rolling", unit: "day", count: 30 } as const;

    const june = resolveRange(range, new Date("2026-06-15T00:00:00.000Z"));
    const december = resolveRange(range, new Date("2026-12-15T00:00:00.000Z"));

    assert.notDeepEqual(june, december, "a rolling range stayed still");
    assert.equal(june?.from.toISOString(), "2026-05-16T00:00:00.000Z");
    assert.equal(december?.from.toISOString(), "2026-11-15T00:00:00.000Z");
  });

  it("counts months and years as calendar steps, not as fixed spans", () => {
    // A month is not thirty days. Somebody asking for "the last month" in March
    // means since February, whatever February happened to be long.
    const from = resolveRange(
      { kind: "rolling", unit: "month", count: 1 },
      new Date("2026-03-31T00:00:00.000Z"),
    )?.from;

    assert.match(from?.toISOString() ?? "", /^2026-0(2|3)/);

    assert.equal(
      resolveRange({ kind: "rolling", unit: "year", count: 1 }, new Date("2026-06-01T00:00:00.000Z"))
        ?.from.toISOString(),
      "2025-06-01T00:00:00.000Z",
    );
  });

  it("has nothing to resolve when a view names no range", () => {
    assert.equal(resolveRange(undefined), undefined);
  });
});

describe("narrowingFor", () => {
  const sqlOf = (specification: ViewSpecification) =>
    narrowingSql(narrowingFor(specification, "t"));

  it("narrows nothing when a view asks for a whole history", () => {
    const narrowing = narrowingFor(view(), "t");

    assert.deepEqual(narrowing.conditions, []);
    assert.equal(narrowingSql(narrowing), "");
  });

  describe("perspective", () => {
    it("keeps only what somebody recorded", () => {
      const narrowing = narrowingFor(view({ perspective: "authored" }), "t");

      assert.match(narrowing.conditions.join(" "), /author_user_id = \{viewPerson/);
      assert.equal(narrowing.params.viewPerson, PERSON);
    });

    it("keeps only what they took part in", () => {
      // The complement, and expressible without a second table: a person's
      // context rows carry the Moment's author, so anything they did not record
      // is something they agreed to.
      const narrowing = narrowingFor(view({ perspective: "participated" }), "t");

      assert.match(narrowing.conditions.join(" "), /author_user_id != \{viewPerson/);
    });

    it("narrows nothing for a place", () => {
      // The schema refuses a perspective a place cannot have, so this reads the
      // context rather than trusting the field: two guards on one rule, and the
      // cheaper one here.
      const place = viewSpecificationSchema.parse({ context: { type: "location", id: PLACE } });

      assert.deepEqual(narrowingFor(place, "t").conditions, []);
    });
  });

  describe("filters", () => {
    it("narrows a person's history to one place", () => {
      // "My father's photographs in Tokyo" — a person as the context and a
      // place as the filter, which is the kind of view this exists for.
      const sql = sqlOf(view({ filters: { locationId: PLACE } }));

      assert.match(sql, /moment_id IN/);
      assert.match(sql, /context_type = 'location'/);
    });

    it("narrows to one occasion", () => {
      const sql = sqlOf(view({ filters: { realWorldEventId: PLACE } }));

      assert.match(sql, /context_type = 'real_world_event'/);
    });

    it("narrows a place's history to one person", () => {
      const sql = narrowingSql(
        narrowingFor(
          viewSpecificationSchema.parse({
            context: { type: "location", id: PLACE },
            filters: { authorUserId: PERSON },
          }),
          "t",
        ),
      );

      assert.match(sql, /author_user_id = \{viewAuthor/);
    });

    it("combines everything it is given", () => {
      const narrowing = narrowingFor(
        view({
          perspective: "participated",
          filters: { locationId: PLACE },
          range: { kind: "fixed", from: "1990-01-01T00:00:00.000Z", to: "1999-12-31T00:00:00.000Z" },
        }),
        "t",
      );

      // Lens, filter, and both ends of the range.
      assert.equal(narrowing.conditions.length, 4);
    });
  });

  describe("range", () => {
    it("bounds by when history happened, never by when it was recorded", () => {
      // A range is a stretch of history. A photograph added today of 1969
      // belongs in a view of the sixties and not in one of this week.
      const narrowing = narrowingFor(
        view({ range: { kind: "fixed", from: "1960-01-01T00:00:00.000Z", to: "1969-12-31T00:00:00.000Z" } }),
        "t",
      );

      assert.match(narrowing.conditions.join(" "), /occurred_at >=/);
      assert.match(narrowing.conditions.join(" "), /occurred_at <=/);
      assert.doesNotMatch(narrowing.conditions.join(" "), /recorded_at/);
    });
  });

  it("writes conditions against whatever table it is given", () => {
    // The same rule is applied to the person context and to the scope context,
    // which are different tables in different queries.
    assert.match(
      narrowingSql(narrowingFor(view({ perspective: "authored" }), "rows")),
      /rows\.author_user_id/,
    );
    assert.match(
      narrowingSql(narrowingFor(view({ perspective: "authored" }), "other")),
      /other\.author_user_id/,
    );
  });
});
