import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  decideRecordLocation,
  evolveLocation,
  initialLocationState,
  type LocationEvent,
} from "./location.aggregate.js";

const now = new Date("2026-08-17T00:00:00.000Z");

const input = {
  locationId: "loc-1",
  recordedByUserId: "user-1",
  name: "Madison Square Garden",
  coordinates: { latitude: 40.7505, longitude: -73.9935 },
  precision: "exact" as const,
  context: {
    neighbourhood: "Chelsea District",
    city: "New York",
    region: "New York",
    country: "United States",
    countryCode: "US",
  },
  sourceReference: "way:138141251",
  now,
};

describe("evolveLocation", () => {
  it("starts absent", () => {
    assert.equal(initialLocationState.exists, false);
  });

  it("records everything a place was understood to be", () => {
    const decision = decideRecordLocation(initialLocationState, input);

    assert.ok(decision.ok);

    const state = evolveLocation(initialLocationState, decision.events[0]!);

    assert.equal(state.exists, true);
    assert.equal(state.name, "Madison Square Garden");
    assert.deepEqual(state.coordinates, { latitude: 40.7505, longitude: -73.9935 });
    assert.equal(state.precision, "exact");
    assert.equal(state.context?.city, "New York");
  });

  it("keeps the map service's reference as provenance, not identity", () => {
    const decision = decideRecordLocation(initialLocationState, input);

    assert.ok(decision.ok);

    const state = evolveLocation(initialLocationState, decision.events[0]!);

    // The identifier is ours; the reference merely says where we learned it.
    assert.equal(state.locationId, "loc-1");
    assert.equal(state.sourceReference, "way:138141251");
    assert.notEqual(state.locationId, state.sourceReference);
  });

  it("ignores event types it does not recognise", () => {
    const state = evolveLocation(initialLocationState, {
      type: "SomethingElse",
      payload: {},
    } as unknown as LocationEvent);

    assert.equal(state, initialLocationState);
  });
});

describe("decideRecordLocation", () => {
  it("records a place with a known position", () => {
    const decision = decideRecordLocation(initialLocationState, input);

    assert.ok(decision.ok);
    assert.equal(decision.events[0]?.type, "LocationRecorded");
  });

  it("records a place nobody can locate", () => {
    // A photograph known only to have been taken "somewhere" is legitimate
    // history, not missing data.
    const decision = decideRecordLocation(initialLocationState, {
      ...input,
      precision: "unknown",
      coordinates: undefined,
    });

    assert.ok(decision.ok);
  });

  it("refuses coordinates for a position nobody knows", () => {
    // The failure this whole model exists to prevent: a coordinate invented to
    // fill a gap becomes historical certainty that was never there.
    const decision = decideRecordLocation(initialLocationState, {
      ...input,
      precision: "unknown",
    });

    assert.deepEqual(decision, { ok: false, reason: "coordinates_not_permitted" });
  });

  it("refuses a known position with no coordinates", () => {
    for (const precision of ["exact", "approximate", "broad"] as const) {
      assert.deepEqual(
        decideRecordLocation(initialLocationState, { ...input, precision, coordinates: undefined }),
        { ok: false, reason: "coordinates_required" },
        precision,
      );
    }
  });

  it("accepts every level of precision that has a position", () => {
    for (const precision of ["exact", "approximate", "broad"] as const) {
      assert.ok(decideRecordLocation(initialLocationState, { ...input, precision }).ok, precision);
    }
  });

  it("records a place the map service has never heard of", () => {
    // A grandparent's house is a place.
    const decision = decideRecordLocation(initialLocationState, {
      ...input,
      name: "Nana's house",
      sourceReference: undefined,
    });

    assert.ok(decision.ok);

    const event = decision.events[0];

    assert.equal(event?.type, "LocationRecorded");
    assert.equal(event.payload.sourceReference, undefined);
  });

  it("refuses to record over a place that already exists", () => {
    const first = decideRecordLocation(initialLocationState, input);

    assert.ok(first.ok);

    const state = evolveLocation(initialLocationState, first.events[0]!);

    assert.deepEqual(decideRecordLocation(state, input), {
      ok: false,
      reason: "location_already_exists",
    });
  });

  it("records who recorded it and when", () => {
    const decision = decideRecordLocation(initialLocationState, input);

    assert.ok(decision.ok);

    const event = decision.events[0];

    assert.equal(event?.type, "LocationRecorded");
    assert.equal(event.payload.recordedByUserId, "user-1");
    assert.equal(event.payload.recordedAt, now.toISOString());
  });
});
