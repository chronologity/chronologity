import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideAssignRole,
  decideRemoveRole,
  evolveUserAuthorization,
  initialUserAuthorizationState,
  type UserAuthorizationEvent,
} from "./user-authorization.aggregate.js";

const now = new Date("2026-08-16T00:00:00.000Z");

const assigned = (role: "moderator" | "administrator"): UserAuthorizationEvent => ({
  type: "UserRoleAssigned",
  payload: {
    userId: "u1",
    role,
    assignedBy: "admin",
    reason: undefined,
    assignedAt: now.toISOString(),
  },
});

const removed = (role: "moderator" | "administrator"): UserAuthorizationEvent => ({
  type: "UserRoleRemoved",
  payload: {
    userId: "u1",
    role,
    removedBy: "admin",
    reason: undefined,
    removedAt: now.toISOString(),
  },
});

describe("evolveUserAuthorization", () => {
  it("starts with no elevated roles", () => {
    assert.deepEqual(initialUserAuthorizationState.roles, []);
  });

  it("adds a granted role", () => {
    const state = evolveUserAuthorization(initialUserAuthorizationState, assigned("moderator"));

    assert.deepEqual(state.roles, ["moderator"]);
  });

  it("accumulates roles", () => {
    let state = evolveUserAuthorization(initialUserAuthorizationState, assigned("moderator"));
    state = evolveUserAuthorization(state, assigned("administrator"));

    assert.deepEqual(state.roles, ["moderator", "administrator"]);
  });

  it("does not duplicate a role replayed twice", () => {
    let state = evolveUserAuthorization(initialUserAuthorizationState, assigned("moderator"));
    state = evolveUserAuthorization(state, assigned("moderator"));

    assert.deepEqual(state.roles, ["moderator"]);
  });

  it("removes a role", () => {
    let state = evolveUserAuthorization(initialUserAuthorizationState, assigned("moderator"));
    state = evolveUserAuthorization(state, removed("moderator"));

    assert.deepEqual(state.roles, []);
  });

  it("removes only the named role", () => {
    let state = evolveUserAuthorization(initialUserAuthorizationState, assigned("moderator"));
    state = evolveUserAuthorization(state, assigned("administrator"));
    state = evolveUserAuthorization(state, removed("moderator"));

    assert.deepEqual(state.roles, ["administrator"]);
  });

  it("removing a role never held changes nothing", () => {
    const state = evolveUserAuthorization(initialUserAuthorizationState, removed("moderator"));

    assert.deepEqual(state.roles, []);
  });

  it("ignores event types it does not recognise", () => {
    const state = evolveUserAuthorization(initialUserAuthorizationState, {
      type: "SomethingElse",
      payload: {},
    } as unknown as UserAuthorizationEvent);

    assert.equal(state, initialUserAuthorizationState);
  });
});

describe("decideAssignRole", () => {
  const input = {
    userId: "u1",
    role: "moderator" as const,
    assignedBy: "admin",
    reason: "trusted",
    now,
  };

  it("grants a role not held", () => {
    const decision = decideAssignRole(initialUserAuthorizationState, input);

    assert.ok(decision.ok);
    assert.equal(decision.events.length, 1);
    assert.equal(decision.events[0]?.type, "UserRoleAssigned");
  });

  it("records who granted it and why", () => {
    const decision = decideAssignRole(initialUserAuthorizationState, input);

    assert.ok(decision.ok);
    assert.deepEqual(decision.events[0]?.payload, {
      userId: "u1",
      role: "moderator",
      assignedBy: "admin",
      reason: "trusted",
      assignedAt: now.toISOString(),
    });
  });

  it("refuses a role already held", () => {
    const state = evolveUserAuthorization(initialUserAuthorizationState, assigned("moderator"));
    const decision = decideAssignRole(state, input);

    assert.deepEqual(decision, { ok: false, reason: "role_already_held" });
  });

  it("refuses granting a role to oneself", () => {
    const decision = decideAssignRole(initialUserAuthorizationState, {
      ...input,
      assignedBy: "u1",
    });

    assert.deepEqual(decision, { ok: false, reason: "self_assignment" });
  });

  it("refuses self-assignment before anything else", () => {
    // Ordering matters: a self-grant of a role already held must report the
    // escalation attempt, not the harmless duplicate.
    const state = evolveUserAuthorization(initialUserAuthorizationState, assigned("moderator"));
    const decision = decideAssignRole(state, { ...input, assignedBy: "u1" });

    assert.deepEqual(decision, { ok: false, reason: "self_assignment" });
  });

  it("permits a grant with no actor, which is the CLI", () => {
    const decision = decideAssignRole(initialUserAuthorizationState, {
      ...input,
      assignedBy: undefined,
    });

    assert.ok(decision.ok);
  });

  it("grants a second, different role", () => {
    const state = evolveUserAuthorization(initialUserAuthorizationState, assigned("moderator"));
    const decision = decideAssignRole(state, { ...input, role: "administrator" });

    assert.ok(decision.ok);
  });
});

describe("decideRemoveRole", () => {
  const input = {
    userId: "u1",
    role: "moderator" as const,
    removedBy: "admin",
    reason: undefined,
    now,
  };

  it("removes a role held", () => {
    const state = evolveUserAuthorization(initialUserAuthorizationState, assigned("moderator"));
    const decision = decideRemoveRole(state, input);

    assert.ok(decision.ok);
    assert.equal(decision.events[0]?.type, "UserRoleRemoved");
  });

  it("refuses to remove a role not held", () => {
    const decision = decideRemoveRole(initialUserAuthorizationState, input);

    assert.deepEqual(decision, { ok: false, reason: "role_not_held" });
  });

  it("permits removing a role from oneself", () => {
    // De-escalation, not escalation: standing down should not require a second
    // administrator.
    const state = evolveUserAuthorization(initialUserAuthorizationState, assigned("administrator"));
    const decision = decideRemoveRole(state, {
      ...input,
      role: "administrator",
      removedBy: "u1",
    });

    assert.ok(decision.ok);
  });

  it("records who removed it", () => {
    const state = evolveUserAuthorization(initialUserAuthorizationState, assigned("moderator"));
    const decision = decideRemoveRole(state, input);

    assert.ok(decision.ok);

    const event = decision.events[0];

    assert.equal(event?.type, "UserRoleRemoved");
    assert.equal(event.payload.removedBy, "admin");
  });
});
