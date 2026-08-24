import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DORMANT_AFTER_DAYS, checkPhoneSignIn } from "./phone.policy.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-23T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

describe("checkPhoneSignIn", () => {
  it("refuses a number nobody has proven", () => {
    const refusal = checkPhoneSignIn({ verifiedAt: null, lastSignedInAt: null }, NOW);

    assert.equal(refusal, "unverified");
  });

  it("refuses an unproven number even if it was somehow used", () => {
    const refusal = checkPhoneSignIn({ verifiedAt: null, lastSignedInAt: daysAgo(1) }, NOW);

    // Proof comes first. A number that was never confirmed is not made
    // trustworthy by having been used.
    assert.equal(refusal, "unverified");
  });

  it("allows a number used recently", () => {
    const refusal = checkPhoneSignIn(
      { verifiedAt: daysAgo(400), lastSignedInAt: daysAgo(3) },
      NOW,
    );

    // Verified long ago is fine. Recent use is what says somebody still holds
    // the telephone.
    assert.equal(refusal, undefined);
  });

  it("allows a freshly proven number that has never signed in", () => {
    const refusal = checkPhoneSignIn({ verifiedAt: daysAgo(1), lastSignedInAt: null }, NOW);

    assert.equal(refusal, undefined);
  });

  it("refuses a number proven long ago and never used", () => {
    const refusal = checkPhoneSignIn(
      { verifiedAt: daysAgo(DORMANT_AFTER_DAYS + 1), lastSignedInAt: null },
      NOW,
    );

    // Measured from proof when there is no use, because that is the last moment
    // anybody demonstrated they held it.
    assert.equal(refusal, "dormant");
  });

  it("refuses a number that has gone quiet", () => {
    const refusal = checkPhoneSignIn(
      { verifiedAt: daysAgo(400), lastSignedInAt: daysAgo(DORMANT_AFTER_DAYS + 1) },
      NOW,
    );

    assert.equal(refusal, "dormant");
  });

  it("allows a number on the last day before it goes quiet", () => {
    const refusal = checkPhoneSignIn(
      { verifiedAt: daysAgo(400), lastSignedInAt: daysAgo(DORMANT_AFTER_DAYS) },
      NOW,
    );

    // The boundary is inclusive: exactly sixty days is still sixty days.
    assert.equal(refusal, undefined);
  });
});
