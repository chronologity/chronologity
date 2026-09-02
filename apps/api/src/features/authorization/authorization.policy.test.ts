import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PERMISSIONS, roleSchema, type Permission, type Role } from "@chronologity/contracts";
import { describe, it } from "vitest";
import {
  effectiveRoles,
  hasPermission,
  mayGrantRole,
  permissionsFor,
  ROLE_PERMISSIONS,
} from "./authorization.policy.js";

/**
 * Who may do what.
 *
 * These need no database, and they are worth exercising exhaustively because
 * what they protect fails silently. A permission wrongly granted does not throw
 * — it lets somebody through, and nothing downstream can tell that apart from a
 * person who was genuinely entitled.
 */

describe("ROLE_PERMISSIONS", () => {
  it("covers every role", () => {
    for (const role of roleSchema.options) {
      assert.ok(role in ROLE_PERMISSIONS, role);
    }
  });

  it("grants only permissions the registry knows", () => {
    // The registry is what stops identifiers drifting. A role granting
    // something absent from it would be granting a permission nothing checks.
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      for (const permission of permissions) {
        assert.ok(PERMISSIONS.includes(permission), `${role} grants unknown ${permission}`);
      }
    }
  });

  it("has some role for every registered permission", () => {
    // The other direction: a permission no role grants can never be held, so
    // the route requiring it is unreachable.
    const granted = new Set(Object.values(ROLE_PERMISSIONS).flat());

    for (const permission of PERMISSIONS) {
      assert.ok(granted.has(permission), `no role grants ${permission}`);
    }
  });

  it("does not give an administrator moderator permissions implicitly", () => {
    for (const permission of ROLE_PERMISSIONS.moderator) {
      assert.ok(
        !ROLE_PERMISSIONS.administrator.includes(permission),
        "administrator must not inherit moderator",
      );
    }
  });

  it("gives the baseline role no elevated permissions", () => {
    assert.deepEqual(ROLE_PERMISSIONS.user, []);
  });
});

describe("permissionsFor", () => {
  it("gives an ordinary User nothing elevated", () => {
    assert.deepEqual(permissionsFor(["user"]), []);
  });

  it("gives an administrator role management", () => {
    assert.deepEqual(permissionsFor(["administrator"]), ["admin:user-role-manage"]);
  });

  it("unions across roles without duplicating", () => {
    const permissions = permissionsFor(["user", "moderator", "administrator"]);

    assert.equal(new Set(permissions).size, permissions.length);
    assert.ok(permissions.includes("admin:user-role-manage"));
  });

  it("gives nothing for no roles", () => {
    assert.deepEqual(permissionsFor([]), []);
  });
});

describe("effectiveRoles", () => {
  it("adds the baseline that is never stored", () => {
    assert.deepEqual(effectiveRoles([]), ["user"]);
  });

  it("keeps elevated roles alongside it", () => {
    assert.deepEqual(effectiveRoles(["moderator"]), ["user", "moderator"]);
  });

  it("does not add the baseline twice", () => {
    assert.deepEqual(effectiveRoles(["user", "moderator"]), ["user", "moderator"]);
  });
});

describe("the registry", () => {
  it("uses one spelling convention throughout", () => {
    // Drift starts with `admin:manageUserRoles` next to
    // `admin:user-role-manage`. Both halves are kebab-case, separated by one
    // colon.
    for (const permission of PERMISSIONS satisfies readonly Permission[]) {
      assert.match(permission, /^[a-z]+:[a-z][a-z-]*[a-z]$/, permission);
    }
  });
});

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

describe("mayGrantRole", () => {
  it("lets an administrator grant a role to somebody else", () => {
    assert.equal(mayGrantRole(randomUUID(), randomUUID()), true);
  });

  it("refuses somebody granting a role to themselves", () => {
    // The invariant this exists for. Holding the permission to manage roles is
    // not permission to raise yourself, or the first administrator would be the
    // last check anyone faced.
    const userId = randomUUID();

    assert.equal(mayGrantRole(userId, userId), false);
  });

  it("permits a grant with no acting User, as the command line makes it", () => {
    // There is no self to escalate to. This is how the first administrator is
    // made, and refusing it would leave the platform with no way to start.
    assert.equal(mayGrantRole(undefined, randomUUID()), true);
  });
});
