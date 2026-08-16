import assert from "node:assert/strict";
import { PERMISSIONS, roleSchema, type Permission } from "@chronologity/contracts";
import { describe, it } from "vitest";
import { effectiveRoles, permissionsFor, ROLE_PERMISSIONS } from "./role-permissions.js";

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
