import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  classifyFailure,
  DEFAULT_MAXIMUM_ATTEMPTS,
  expiresAt,
  hasExpired,
  partName,
  partsNeeded,
  retryAfter,
  stateAfterFailure,
} from "./export.policy.js";

const at = new Date("2026-06-10T12:00:00Z");

describe("partName", () => {
  it("counts from one", () => {
    // Parts are described to a person, and a manifest beginning at zero reads
    // as though something is missing.
    assert.equal(partName(1), "moments-0001.json");
  });

  it("pads so that parts sort in the order they were written", () => {
    const names = [partName(2), partName(10), partName(1)].sort();

    assert.deepEqual(names, ["moments-0001.json", "moments-0002.json", "moments-0010.json"]);
  });

  it("refuses a part below one", () => {
    assert.throws(() => partName(0), RangeError);
    assert.throws(() => partName(-1), RangeError);
  });
});

describe("partsNeeded", () => {
  it("splits an exact multiple evenly", () => {
    assert.equal(partsNeeded(400, 200), 2);
  });

  it("gives a remainder its own part", () => {
    assert.equal(partsNeeded(401, 200), 3);
    assert.equal(partsNeeded(1, 200), 1);
  });

  it("gives an empty history one part rather than none", () => {
    // Somebody with no Moments still has an account, comments, and
    // relationships. A manifest claiming zero parts would read as a failure.
    assert.equal(partsNeeded(0, 200), 1);
  });
});

describe("expiresAt and hasExpired", () => {
  it("expires after the configured days", () => {
    assert.equal(expiresAt(at, 3).toISOString(), "2026-06-13T12:00:00.000Z");
  });

  it("never expires before it was prepared", () => {
    for (const days of [0, -1, 3]) {
      assert.ok(expiresAt(at, days).getTime() >= at.getTime(), String(days));
    }
  });

  it("treats an instant in the past as expired", () => {
    assert.equal(hasExpired(new Date("2026-06-09T12:00:00Z"), at), true);
  });

  it("treats the instant itself as expired", () => {
    // The boundary belongs to the side that withholds: what is being withheld
    // is a copy of somebody's entire history.
    assert.equal(hasExpired(at, at), true);
  });

  it("treats an instant still ahead as available", () => {
    assert.equal(hasExpired(new Date("2026-06-11T12:00:00Z"), at), false);
  });

  it("treats an export never prepared as not expired", () => {
    // It has nothing to expire. Whether it can be downloaded is a question
    // about its state, not about its age.
    assert.equal(hasExpired(undefined, at), false);
  });
});

describe("stateAfterFailure", () => {
  it("stops at once on a permanent failure", () => {
    assert.equal(stateAfterFailure("permanent", 1, 5), "failed");
    assert.equal(stateAfterFailure("permanent", 0, 5), "failed");
  });

  it("retries a transient failure below the ceiling", () => {
    assert.equal(stateAfterFailure("transient", 1, 5), "pending");
    assert.equal(stateAfterFailure("transient", 4, 5), "pending");
  });

  it("abandons at and past the ceiling", () => {
    assert.equal(stateAfterFailure("transient", 5, 5), "abandoned");
    assert.equal(stateAfterFailure("transient", 40, 5), "abandoned");
  });

  it("gives up sooner than erasure does", () => {
    // Somebody is waiting for this. An export that has failed five times is
    // better reported than retried quietly for another hour.
    assert.equal(DEFAULT_MAXIMUM_ATTEMPTS, 5);
    assert.equal(stateAfterFailure("transient", DEFAULT_MAXIMUM_ATTEMPTS), "abandoned");
  });
});

describe("retryAfter", () => {
  it("doubles with each attempt", () => {
    assert.equal(retryAfter(at, 1, 1_000).toISOString(), "2026-06-10T12:00:01.000Z");
    assert.equal(retryAfter(at, 3, 1_000).toISOString(), "2026-06-10T12:00:04.000Z");
  });

  it("caps the delay", () => {
    assert.equal(retryAfter(at, 40, 30_000).toISOString(), "2026-06-10T13:00:00.000Z");
  });

  it("never schedules a retry in the past", () => {
    for (const attempts of [0, 1, 40]) {
      assert.ok(retryAfter(at, attempts, 1_000).getTime() >= at.getTime(), String(attempts));
    }
  });
});

describe("classifyFailure", () => {
  it("treats a constraint violation as permanent", () => {
    const refusal = new Error("null value violates not-null constraint");

    refusal.name = "QueryFailedError";

    assert.equal(classifyFailure(refusal), "permanent");
  });

  it("treats an unreachable store as transient", () => {
    assert.equal(classifyFailure(new Error("connection reset")), "transient");
  });

  it("treats anything unrecognised as transient", () => {
    // Erring towards eventually producing the export rather than towards
    // telling somebody their history could not be assembled.
    assert.equal(classifyFailure("a string nobody expected"), "transient");
    assert.equal(classifyFailure(undefined), "transient");
  });
});
