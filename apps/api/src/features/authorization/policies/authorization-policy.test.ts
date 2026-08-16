import assert from "node:assert/strict";
import type { Role } from "@chronologity/contracts";
import { describe, it } from "node:test";
import { hasPermission } from "./authorization-policy.js";

describe("hasPermission", () => {
  it("allows an administrator to manage roles", () => {
    assert.equal(hasPermission(["administrator"], "admin:user-role-manage"), true);
  });

  it("refuses an ordinary User", () => {
    assert.equal(hasPermission([], "admin:user-role-manage"), false);
  });

  it("refuses a moderator, who has no administrative authority", () => {
    assert.equal(hasPermission(["moderator"], "admin:user-role-manage"), false);
  });

  it("adds the baseline role itself, so callers pass what is stored", () => {
    // An empty array is an ordinary User, not an actor with no roles at all.
    assert.equal(hasPermission([], "admin:user-role-manage"), false);
    assert.equal(hasPermission(["administrator"], "admin:user-role-manage"), true);
  });

  it("allows when any held role grants it", () => {
    assert.equal(hasPermission(["moderator", "administrator"], "admin:user-role-manage"), true);
  });

  it("denies rather than trusting a role it does not recognise", () => {
    // Deny is the default. A role that arrived from stale data or a bad
    // migration must contribute nothing rather than be assumed powerful.
    assert.equal(hasPermission(["superuser" as unknown as Role], "admin:user-role-manage"), false);
  });
});
