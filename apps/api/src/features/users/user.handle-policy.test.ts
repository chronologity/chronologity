import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  checkHandle,
  describeHandleRejection,
  mayClaimReleasedHandle,
  normalizeHandle,
} from "./user.handle-policy.js";

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

describe("mayClaimReleasedHandle — the cooldown", () => {
  const owner = "11111111-1111-1111-1111-111111111111";
  const stranger = "22222222-2222-2222-2222-222222222222";
  const released = new Date("2026-01-01T00:00:00.000Z");
  const days = (n: number) => new Date(released.getTime() + n * 24 * 60 * 60 * 1000);

  it("refuses somebody else while the handle is still reserved", () => {
    // The rule that exists to prevent impersonation. Handing a recognisable
    // handle straight to the next person is how somebody inherits an audience
    // that was never theirs.
    assert.equal(mayClaimReleasedHandle(released, owner, stranger, 30, days(29)), false);
  });

  it("lets somebody else claim it once the cooldown has passed", () => {
    assert.equal(mayClaimReleasedHandle(released, owner, stranger, 30, days(31)), true);
  });

  it("treats the moment the cooldown ends as free", () => {
    // The boundary. Reserved *until* that instant, not through it.
    assert.equal(mayClaimReleasedHandle(released, owner, stranger, 30, days(30)), true);
  });

  it("always lets the original holder take their own handle back", () => {
    // Mid-cooldown, and on the first day. The cooldown protects them from
    // somebody else, not from themselves.
    assert.equal(mayClaimReleasedHandle(released, owner, owner, 30, days(1)), true);
    assert.equal(mayClaimReleasedHandle(released, owner, owner, 30, days(29)), true);
  });

  it("honours a configured cooldown rather than a fixed one", () => {
    // The period is a product decision that is explicitly still open, so it
    // must come from configuration rather than be baked in here.
    assert.equal(mayClaimReleasedHandle(released, owner, stranger, 7, days(8)), true);
    assert.equal(mayClaimReleasedHandle(released, owner, stranger, 90, days(31)), false);
  });

  it("frees a handle immediately when there is no cooldown at all", () => {
    assert.equal(mayClaimReleasedHandle(released, owner, stranger, 0, days(0)), true);
  });
});
