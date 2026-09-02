import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { changesNothing, isHandleChange, profileChanges } from "./user.policy.js";

/**
 * What a profile change actually changes.
 *
 * The distinction under test here is the one that is easy to collapse and
 * expensive to get wrong: null clears a field, undefined leaves it. Treat them
 * alike and a biography becomes something a person can set but never remove.
 */

const current = { displayName: "Richard", biography: "Building things." };

describe("profileChanges", () => {
  it("reports a changed display name", () => {
    assert.deepEqual(profileChanges(current, { displayName: "Richard B" }), {
      displayName: "Richard B",
    });
  });

  it("reports a changed biography", () => {
    assert.deepEqual(profileChanges(current, { biography: "Still building." }), {
      biography: "Still building.",
    });
  });

  it("treats null as clearing the biography", () => {
    // The case the tri-state exists for. Without it there is no way to remove
    // a biography once written.
    assert.deepEqual(profileChanges(current, { biography: null }), { biography: null });
  });

  it("treats undefined as leaving the biography alone", () => {
    assert.deepEqual(profileChanges(current, { displayName: "Richard B" }), {
      displayName: "Richard B",
    });
  });

  it("reports nothing when the values match what is stored", () => {
    // Saving a form without editing it did not happen, and should not be
    // recorded as though it did.
    assert.deepEqual(profileChanges(current, { displayName: "Richard" }), {});
    assert.deepEqual(profileChanges(current, { biography: "Building things." }), {});
  });

  it("reports nothing when clearing a biography that is already absent", () => {
    const empty = { displayName: "Richard", biography: null };

    assert.deepEqual(profileChanges(empty, { biography: null }), {});
  });

  it("reports clearing a biography that exists", () => {
    assert.deepEqual(profileChanges(current, { biography: null }), { biography: null });
  });

  it("reports both when both change", () => {
    assert.deepEqual(profileChanges(current, { displayName: "R", biography: null }), {
      displayName: "R",
      biography: null,
    });
  });

  it("reports nothing for an empty request", () => {
    assert.deepEqual(profileChanges(current, {}), {});
  });

  it("distinguishes an empty biography from an absent one", () => {
    // An empty string is a biography somebody wrote and then emptied; null is
    // the absence of one. They are different stored values.
    const empty = { displayName: "Richard", biography: null };

    assert.deepEqual(profileChanges(empty, { biography: "" }), { biography: "" });
  });
});

describe("changesNothing", () => {
  it("recognises an empty set of changes", () => {
    assert.equal(changesNothing({}), true);
  });

  it("recognises a real change", () => {
    assert.equal(changesNothing({ displayName: "R" }), false);
    assert.equal(changesNothing({ biography: null }), false);
  });
});

describe("isHandleChange", () => {
  it("recognises a different handle", () => {
    assert.equal(isHandleChange("richard", "richardb"), true);
  });

  it("recognises the same handle", () => {
    assert.equal(isHandleChange("richard", "richard"), false);
  });

  it("treats a change of capitalisation as a real change", () => {
    // Compared as chosen rather than normalised. `@richard` to `@Richard` is a
    // presentation change, and presentation is what a handle is for.
    assert.equal(isHandleChange("richard", "Richard"), true);
  });
});
