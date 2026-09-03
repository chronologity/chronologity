import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { Location, LocationDisclosure } from "@chronologity/contracts";
import { disclosePlace } from "./place-disclosure.js";

const AUTHOR = "author";
const STRANGER = "stranger";

const place: Location = {
  locationId: "11111111-1111-4111-8111-111111111111",
  name: "Madison Square Garden",
  coordinates: { latitude: 40.7505, longitude: -73.9934 },
  precision: "exact",
  context: {
    neighbourhood: "Midtown",
    city: "New York City",
    region: "New York",
    country: "United States",
    countryCode: "US",
  },
  sourceReference: "osm:way/123",
  source: "explicit-selection",
  createdAt: "2026-08-23T00:00:00.000Z",
};

describe("disclosePlace", () => {
  it("says nothing when the Moment has no place", () => {
    assert.equal(disclosePlace(STRANGER, AUTHOR, "exact", undefined), null);
  });

  it("gives the author the exact place whatever they chose for others", () => {
    for (const disclosure of ["exact", "neighbourhood", "city", "hidden"] as const) {
      const disclosed = disclosePlace(AUTHOR, AUTHOR, disclosure, place);

      assert.deepEqual(disclosed, { disclosure: "exact", location: place, area: null });
    }
  });

  it("gives a stranger the exact place when that is what the author chose", () => {
    const disclosed = disclosePlace(STRANGER, AUTHOR, "exact", place);

    assert.deepEqual(disclosed, { disclosure: "exact", location: place, area: null });
  });

  it("gives a neighbourhood without the place itself", () => {
    const disclosed = disclosePlace(STRANGER, AUTHOR, "neighbourhood", place);

    assert.equal(disclosed?.location, null);
    assert.equal(disclosed?.area?.neighbourhood, "Midtown");
    assert.equal(disclosed?.area?.city, "New York City");
  });

  it("withholds the neighbourhood at city level", () => {
    const disclosed = disclosePlace(STRANGER, AUTHOR, "city", place);

    assert.equal(disclosed?.area?.neighbourhood, null);
    assert.equal(disclosed?.area?.city, "New York City");
    assert.equal(disclosed?.area?.country, "United States");
  });

  it("says only that a place is withheld when it is hidden", () => {
    const disclosed = disclosePlace(STRANGER, AUTHOR, "hidden", place);

    // Not null. "Nobody said where" and "you are not being told where" are
    // different facts, and a client should be able to tell them apart.
    assert.deepEqual(disclosed, { disclosure: "hidden", location: null, area: null });
  });

  it("never carries an identifier below exact", () => {
    for (const disclosure of ["neighbourhood", "city", "hidden"] as const) {
      const disclosed = disclosePlace(STRANGER, AUTHOR, disclosure, place);

      // The whole reason a reduced place is safe: there is nothing to look up.
      // An identifier would let anybody read back what was just withheld.
      assert.equal(disclosed?.location, null, disclosure);
      assert.equal(JSON.stringify(disclosed).includes(place.locationId), false, disclosure);
    }
  });

  it("never carries coordinates below exact", () => {
    for (const disclosure of ["neighbourhood", "city", "hidden"] as const) {
      const disclosed = disclosePlace(STRANGER, AUTHOR, disclosure, place);

      assert.equal(JSON.stringify(disclosed).includes("40.75"), false, disclosure);
    }
  });

  it("withholds everything for a disclosure it does not recognise", () => {
    const disclosed = disclosePlace(
      STRANGER,
      AUTHOR,
      "somewhere-ish" as LocationDisclosure,
      place,
    );

    // Default deny. A widened constraint that forgot this file should show a
    // Viewer less than intended, never more.
    assert.deepEqual(disclosed, { disclosure: "hidden", location: null, area: null });
  });
});
