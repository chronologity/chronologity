import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ageOn, checkAge, describeAgeRejection } from "./age-policy.js";

const on = (date: string) => new Date(`${date}T00:00:00.000Z`);

describe("ageOn", () => {
  it("counts whole years", () => {
    assert.equal(ageOn("2000-06-15", on("2026-06-15")), 26);
  });

  it("does not count a birthday that has not arrived", () => {
    assert.equal(ageOn("2000-06-15", on("2026-06-14")), 25);
  });

  it("counts it on the day itself", () => {
    assert.equal(ageOn("2013-08-15", on("2026-08-15")), 13);
  });

  it("does not count it the day before", () => {
    assert.equal(ageOn("2013-08-16", on("2026-08-15")), 12);
  });

  it("ages a leap-day birth on the first of March in a common year", () => {
    // The safe direction: younger for one extra day rather than older.
    assert.equal(ageOn("2008-02-29", on("2026-02-28")), 17);
    assert.equal(ageOn("2008-02-29", on("2026-03-01")), 18);
  });

  it("ages a leap-day birth on the day itself in a leap year", () => {
    assert.equal(ageOn("2008-02-29", on("2028-02-29")), 20);
  });

  it("is negative for a date in the future", () => {
    assert.equal(ageOn("2030-01-01", on("2026-08-15")), -4);
  });

  it("does not depend on the time of day", () => {
    const early = new Date("2026-06-15T00:00:00.000Z");
    const late = new Date("2026-06-15T23:59:59.999Z");

    assert.equal(ageOn("2000-06-15", early), ageOn("2000-06-15", late));
  });

  it("rejects dates that do not exist", () => {
    // `Date` would roll this into March rather than refusing it.
    assert.equal(ageOn("2026-02-30", on("2026-08-15")), undefined);
    assert.equal(ageOn("2025-02-29", on("2026-08-15")), undefined);
    assert.equal(ageOn("2026-13-01", on("2026-08-15")), undefined);
    assert.equal(ageOn("2026-00-10", on("2026-08-15")), undefined);
  });

  it("rejects anything that is not a plain calendar date", () => {
    for (const input of ["", "15/06/2000", "2000-6-15", "2000-06-15T00:00:00Z", "yesterday"]) {
      assert.equal(ageOn(input, on("2026-08-15")), undefined, input);
    }
  });
});

describe("checkAge", () => {
  const now = on("2026-08-15");

  it("admits someone above the minimum", () => {
    assert.deepEqual(checkAge("2000-01-01", 13, now), { ok: true, age: 26 });
  });

  it("admits someone exactly at the minimum, on the day", () => {
    assert.deepEqual(checkAge("2013-08-15", 13, now), { ok: true, age: 13 });
  });

  it("refuses someone one day short", () => {
    assert.deepEqual(checkAge("2013-08-16", 13, now), { ok: false, reason: "below_minimum" });
  });

  it("honours a different minimum", () => {
    // The same birthdate, admitted under one threshold and refused under another.
    assert.deepEqual(checkAge("2010-08-15", 13, now), { ok: true, age: 16 });
    assert.deepEqual(checkAge("2010-08-15", 16, now), { ok: true, age: 16 });
    assert.deepEqual(checkAge("2010-08-16", 16, now), { ok: false, reason: "below_minimum" });
  });

  it("admits anyone when the minimum is zero", () => {
    assert.deepEqual(checkAge("2026-08-15", 0, now), { ok: true, age: 0 });
  });

  it("refuses a date that is not a date", () => {
    assert.deepEqual(checkAge("2026-02-30", 13, now), { ok: false, reason: "not_a_date" });
  });

  it("refuses a date in the future", () => {
    assert.deepEqual(checkAge("2030-01-01", 13, now), { ok: false, reason: "in_the_future" });
  });

  it("refuses an implausible age", () => {
    assert.deepEqual(checkAge("1850-01-01", 13, now), { ok: false, reason: "implausible" });
  });
});

describe("describeAgeRejection", () => {
  it("says so when the date is unusable, since that is a typo to fix", () => {
    assert.match(describeAgeRejection("not_a_date"), /calendar date/i);
    assert.match(describeAgeRejection("in_the_future"), /calendar date/i);
  });

  it("never states the threshold", () => {
    // Stating it turns the gate into instructions for getting past it.
    for (const reason of ["not_a_date", "in_the_future", "implausible", "below_minimum"] as const) {
      const message = describeAgeRejection(reason);

      assert.doesNotMatch(message, /\d/, reason);
      assert.doesNotMatch(message, /\b(age|old|young|birth ?day)\b/i, reason);
    }
  });

  it("gives being under the minimum no distinguishing message", () => {
    assert.equal(describeAgeRejection("below_minimum"), describeAgeRejection("implausible"));
  });
});
