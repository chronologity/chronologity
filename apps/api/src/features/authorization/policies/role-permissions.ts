import type { Permission, Role } from "@chronologity/contracts";

/**
 * Which role grants which permissions.
 *
 * Server-side by design. The identifiers are a boundary contract and live in
 * `packages/contracts`; the mapping is an internal decision, and publishing it
 * would invite clients to reimplement authorization rather than ask for it.
 *
 * There is no hierarchy. An administrator is not implicitly a moderator:
 * `authorization.md:176-184` warns against assuming a chain the permission
 * model has not defined, and someone who needs both roles gets both,
 * explicitly and auditably.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  // The baseline. Ordinary product capabilities are governed by ownership —
  // your profile is yours because it is yours — rather than by named
  // permissions, so there is nothing here yet.
  user: [],
  // Empty until moderation ships. The role boundary exists now so that
  // privileged capability has somewhere to land that is not `administrator`;
  // the capabilities arrive with the feature that needs them.
  moderator: [],
  administrator: ["admin:user-role-manage"],
};

/**
 * The permissions a set of roles confers.
 *
 * @param roles - Roles held. The baseline `user` role is not implied: callers
 *   pass the full effective set, which `effectiveRoles` produces.
 * @returns The union of their permissions, without duplicates. A role the
 *   mapping does not recognise contributes nothing rather than throwing:
 *   deny-by-default has to survive stale data, and a role name that outlived
 *   its definition must not be able to take down every authorization check
 *   that reads it.
 */
export function permissionsFor(roles: readonly Role[]): readonly Permission[] {
  const granted = new Set<Permission>();

  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) {
      granted.add(permission);
    }
  }

  return [...granted];
}

/**
 * The full role set for a User, baseline included.
 *
 * @param elevated - Roles stored against the account.
 * @returns Those roles plus `user`, which every account holds by virtue of
 *   being an account and which is therefore never stored.
 */
export function effectiveRoles(elevated: readonly Role[]): readonly Role[] {
  return elevated.includes("user") ? elevated : ["user", ...elevated];
}
