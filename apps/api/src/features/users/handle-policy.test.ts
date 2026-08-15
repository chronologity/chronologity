import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkHandle, describeHandleRejection, normalizeHandle } from "./handle-policy.js";

describe("normalizeHandle", () => {
  it("lowercases and trims", () => {
    assert.equal(normalizeHandle("  Richard "), "richard");
  });

  it("collapses case variants to one identity", () => {
    // @Richard, @richard, and @RICHARD must not be three different people.
    const forms = ["Richard", "richard", "RICHARD", "RiChArD"].map(normalizeHandle);

    assert.equal(new Set(forms).size, 1);
  });
});

describe("checkHandle", () => {
  it("accepts an ordinary handle and returns its normalised form", () => {
    assert.deepEqual(checkHandle("Richard_B"), { ok: true, normalized: "richard_b" });
  });

  it("rejects handles outside the length bounds", () => {
    assert.equal(checkHandle("ab").ok, false);
    assert.equal(checkHandle("abc").ok, true);
    assert.equal(checkHandle("a".repeat(30)).ok, true);
    assert.equal(checkHandle("a".repeat(31)).ok, false);
  });

  it("rejects characters that would make handles confusable or unroutable", () => {
    for (const handle of ["rich ard", "rich.ard", "rich-ard", "rich@ard", "rich/ard", "riché"]) {
      assert.equal(checkHandle(handle).ok, false, handle);
    }
  });

  it("refuses handles that would collide with routes", () => {
    for (const handle of ["api", "users", "settings", "health"]) {
      const result = checkHandle(handle);
      assert.equal(result.ok === false && result.reason, "reserved", handle);
    }
  });

  it("refuses short reserved words on length, and keeps reserving them anyway", () => {
    // "me" is below the minimum, so length refuses it first and the reserved
    // check never runs. It stays on the list regardless: if the minimum ever
    // drops, the protection should already be there rather than needing to be
    // remembered.
    assert.equal(checkHandle("me").ok, false);
  });

  it("refuses handles that would be believed", () => {
    // An account at @support is trusted in a way @dave is not.
    for (const handle of ["support", "security", "billing", "official", "chronologity"]) {
      const result = checkHandle(handle);
      assert.equal(result.ok === false && result.reason, "reserved", handle);
    }
  });

  it("catches reserved handles regardless of casing", () => {
    assert.equal(checkHandle("Support").ok, false);
    assert.equal(checkHandle("ADMIN").ok, false);
  });

  it("does not refuse handles that merely contain a reserved word", () => {
    // Reserving "admin" must not cost every "admiral" their name.
    assert.equal(checkHandle("admiral").ok, true);
    assert.equal(checkHandle("supporter").ok, true);
  });
});

describe("describeHandleRejection", () => {
  it("explains length and character rules", () => {
    assert.match(describeHandleRejection("too_short"), /at least 3/);
    assert.match(describeHandleRejection("too_long"), /at most 30/);
    assert.match(describeHandleRejection("invalid_characters"), /letters, numbers/);
  });

  it("says nothing about why a reserved handle is unavailable", () => {
    // Distinguishing "reserved" from "taken" maps out the reserved list.
    assert.equal(describeHandleRejection("reserved"), "That handle is not available");
  });
});
