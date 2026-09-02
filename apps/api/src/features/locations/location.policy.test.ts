import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { checkPosition, describeLocationRejection, fillContext } from "./location.policy.js";

/**
 * The rules a place has to satisfy.
 *
 * These need no database. What they protect is not a technical invariant but a
 * historical one: a place that claims a position it never had is a fabricated
 * fact about where somebody was, and it looks exactly like a real one.
 */

const somewhere = { latitude: 51.5, longitude: -0.12 };

describe("checkPosition", () => {
  it("accepts a known position with coordinates", () => {
    for (const precision of ["exact", "approximate", "broad"] as const) {
      assert.equal(checkPosition(precision, somewhere), undefined, precision);
    }
  });

  it("accepts an unknown position with no coordinates", () => {
    // Legitimate history rather than missing data. Someone who only remembers
    // that a photograph was taken somewhere in the Lake District must be able
    // to say so.
    assert.equal(checkPosition("unknown", undefined), undefined);
  });

  it("refuses a known position with nothing to locate it", () => {
    for (const precision of ["exact", "approximate", "broad"] as const) {
      assert.equal(checkPosition(precision, undefined), "coordinates_required", precision);
    }
  });

  it("refuses coordinates attached to an unknown position", () => {
    // The failure this exists to prevent. Accepting both would record a precise
    // point for a place nobody could locate, and nothing downstream could tell
    // that apart from a position somebody actually knew.
    assert.equal(checkPosition("unknown", somewhere), "coordinates_not_permitted");
  });

  it("refuses the null island the same as anywhere else", () => {
    // Zero is a real coordinate here. Whether a camera meant it is a question
    // for whatever read it out of a file, not for a place someone recorded.
    assert.equal(checkPosition("exact", { latitude: 0, longitude: 0 }), undefined);
    assert.equal(
      checkPosition("unknown", { latitude: 0, longitude: 0 }),
      "coordinates_not_permitted",
    );
  });
});

describe("describeLocationRejection", () => {
  it("says which way round the disagreement was", () => {
    assert.match(describeLocationRejection("coordinates_required"), /needs coordinates/);
    assert.match(
      describeLocationRejection("coordinates_not_permitted"),
      /cannot carry coordinates/,
    );
  });
});

describe("fillContext", () => {
  it("keeps what was recorded", () => {
    const context = fillContext({
      neighbourhood: "Chelsea",
      city: "New York",
      region: "New York",
      country: "United States",
      countryCode: "US",
    });

    assert.equal(context.city, "New York");
    assert.equal(context.countryCode, "US");
  });

  it("records what was not stated as null rather than leaving it absent", () => {
    // Null says the area was not known when the place was recorded. A missing
    // key says nothing at all, and something later has to decide whether that
    // means "unknown" or "never asked".
    const context = fillContext(undefined);

    assert.deepEqual(context, {
      neighbourhood: null,
      city: null,
      region: null,
      country: null,
      countryCode: null,
    });
  });

  it("fills only the areas that were left out", () => {
    const context = fillContext({ city: "Reykjavík" });

    assert.equal(context.city, "Reykjavík");
    assert.equal(context.country, null);
  });

  it("treats an explicitly undefined area as unstated", () => {
    // A parsed request body produces a present key holding undefined, which is
    // a different thing from a missing key and must not become one.
    const context = fillContext({ city: undefined, country: "Iceland" });

    assert.equal(context.city, null);
    assert.equal(context.country, "Iceland");
  });
});
