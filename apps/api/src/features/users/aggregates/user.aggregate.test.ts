import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideChangeHandle,
  decideCreateUser,
  decideDeactivate,
  decideReactivate,
  decideUpdateProfile,
  evolveUser,
  initialUserState,
  type UserEvent,
  type UserState,
} from "./user.aggregate.js";

const userId = "66666666-6666-4666-8666-666666666666";
const identityId = "77777777-7777-4777-8777-777777777777";
const now = new Date("2026-08-15T12:00:00.000Z");
const later = new Date("2026-08-15T13:00:00.000Z");

const replay = (events: readonly UserEvent[]): UserState =>
  events.reduce(evolveUser, initialUserState);

const created = (overrides: Partial<{ handle: string; biography: string | undefined }> = {}) => {
  const decision = decideCreateUser(initialUserState, {
    userId,
    identityId,
    handle: overrides.handle ?? "richard",
    normalizedHandle: (overrides.handle ?? "richard").toLowerCase(),
    displayName: "Richard",
    biography: "biography" in overrides ? overrides.biography : undefined,
    now,
  });

  return decision.ok ? decision.events : [];
};

describe("user state", () => {
  it("starts absent", () => {
    assert.equal(initialUserState.exists, false);
  });

  it("records the Identity it belongs to", () => {
    const state = replay(created());

    assert.equal(state.identityId, identityId);
    assert.equal(state.userId, userId);
    assert.equal(state.status, "active");
  });

  it("ignores event types it does not recognise", () => {
    const state = replay([
      ...created(),
      { type: "FromTheFuture", payload: {} } as unknown as UserEvent,
    ]);

    assert.equal(state.exists, true);
  });

  it("distinguishes clearing a biography from leaving it alone", () => {
    // Collapsing null and undefined would make it impossible to remove one.
    const withBiography = replay(created({ biography: "Photographer" }));
    assert.equal(withBiography.biography, "Photographer");

    const untouched = evolveUser(withBiography, {
      type: "UserProfileUpdated",
      payload: { displayName: "Rich", biography: undefined, updatedAt: later.toISOString() },
    });
    assert.equal(untouched.biography, "Photographer");
    assert.equal(untouched.displayName, "Rich");

    const cleared = evolveUser(withBiography, {
      type: "UserProfileUpdated",
      payload: { displayName: undefined, biography: null, updatedAt: later.toISOString() },
    });
    assert.equal(cleared.biography, undefined);
  });
});

describe("decideCreateUser", () => {
  it("creates the account", () => {
    const decision = decideCreateUser(initialUserState, {
      userId,
      identityId,
      handle: "richard",
      normalizedHandle: "richard",
      displayName: "Richard",
      biography: undefined,
      now,
    });

    assert.equal(decision.ok, true);
    assert.equal(decision.ok && decision.events[0]?.type, "UserCreated");
  });

  it("refuses to create a second account over the first", () => {
    const decision = decideCreateUser(replay(created()), {
      userId,
      identityId,
      handle: "other",
      normalizedHandle: "other",
      displayName: "Other",
      biography: undefined,
      now,
    });

    assert.equal(decision.ok === false && decision.reason, "user_already_exists");
  });
});

describe("decideUpdateProfile", () => {
  it("records a changed display name", () => {
    const decision = decideUpdateProfile(replay(created()), { displayName: "Rich", now: later });

    assert.equal(decision.ok, true);
  });

  it("refuses a change that would alter nothing", () => {
    // History should say what happened, and saving a form unchanged did not.
    const decision = decideUpdateProfile(replay(created()), {
      displayName: "Richard",
      now: later,
    });

    assert.equal(decision.ok === false && decision.reason, "nothing_to_update");
  });

  it("treats clearing an absent biography as no change", () => {
    const decision = decideUpdateProfile(replay(created()), { biography: null, now: later });

    assert.equal(decision.ok === false && decision.reason, "nothing_to_update");
  });

  it("treats clearing a present biography as a change", () => {
    const decision = decideUpdateProfile(replay(created({ biography: "Photographer" })), {
      biography: null,
      now: later,
    });

    assert.equal(decision.ok, true);
  });

  it("refuses on a deactivated account", () => {
    const state = replay([
      ...created(),
      { type: "UserDeactivated", payload: { deactivatedAt: later.toISOString() } },
    ]);

    const decision = decideUpdateProfile(state, { displayName: "Rich", now: later });

    assert.equal(decision.ok === false && decision.reason, "user_deactivated");
  });

  it("refuses when there is no account", () => {
    const decision = decideUpdateProfile(initialUserState, { displayName: "Rich", now });

    assert.equal(decision.ok === false && decision.reason, "user_not_found");
  });
});

describe("decideChangeHandle", () => {
  it("records the previous handle alongside the new one", () => {
    const decision = decideChangeHandle(replay(created({ handle: "richard" })), {
      handle: "rb",
      normalizedHandle: "rb",
      now: later,
    });

    assert.equal(decision.ok, true);

    const event = decision.ok ? decision.events[0] : undefined;
    assert.equal(
      event?.type === "UserHandleChanged" ? event.payload.previousHandle : undefined,
      "richard",
    );
  });

  it("does not change identity", () => {
    // A handle change breaks no provenance: the account is the same account.
    const before = replay(created({ handle: "richard" }));
    const decision = decideChangeHandle(before, {
      handle: "rb",
      normalizedHandle: "rb",
      now: later,
    });
    const after = (decision.ok ? decision.events : []).reduce(evolveUser, before);

    assert.equal(after.userId, before.userId);
    assert.equal(after.identityId, before.identityId);
    assert.equal(after.handle, "rb");
  });

  it("refuses the handle already held", () => {
    const decision = decideChangeHandle(replay(created({ handle: "richard" })), {
      handle: "richard",
      normalizedHandle: "richard",
      now: later,
    });

    assert.equal(decision.ok === false && decision.reason, "handle_unchanged");
  });

  it("allows a change of capitalisation, which is a real change to presentation", () => {
    const decision = decideChangeHandle(replay(created({ handle: "richard" })), {
      handle: "Richard",
      normalizedHandle: "richard",
      now: later,
    });

    assert.equal(decision.ok, true);
  });

  it("refuses on a deactivated account, and when there is none", () => {
    const deactivated = replay([
      ...created(),
      { type: "UserDeactivated", payload: { deactivatedAt: later.toISOString() } },
    ]);

    assert.equal(
      decideChangeHandle(deactivated, { handle: "rb", normalizedHandle: "rb", now: later }).ok ===
        false,
      true,
    );
    assert.equal(
      decideChangeHandle(initialUserState, { handle: "rb", normalizedHandle: "rb", now }).ok,
      false,
    );
  });
});

describe("deactivation and reactivation", () => {
  it("deactivates an active account", () => {
    const decision = decideDeactivate(replay(created()), { now: later });

    assert.equal(decision.ok, true);
    assert.equal(decision.ok && decision.events[0]?.type, "UserDeactivated");
  });

  it("refuses to deactivate twice", () => {
    const state = replay([
      ...created(),
      { type: "UserDeactivated", payload: { deactivatedAt: later.toISOString() } },
    ]);

    assert.equal(decideDeactivate(state, { now: later }).ok === false, true);
  });

  it("reactivates a deactivated account", () => {
    const state = replay([
      ...created(),
      { type: "UserDeactivated", payload: { deactivatedAt: later.toISOString() } },
    ]);

    const decision = decideReactivate(state, { now: later });

    assert.equal(decision.ok, true);
    assert.equal(decision.ok && decision.events[0]?.type, "UserReactivated");
  });

  it("refuses to reactivate an active account", () => {
    assert.equal(decideReactivate(replay(created()), { now: later }).ok === false, true);
  });

  it("refuses both when there is no account", () => {
    assert.equal(decideDeactivate(initialUserState, { now }).ok, false);
    assert.equal(decideReactivate(initialUserState, { now }).ok, false);
  });
});
