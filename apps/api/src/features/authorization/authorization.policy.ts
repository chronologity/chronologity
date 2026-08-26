import type { Permission, Role } from "@chronologity/contracts";

/**
 * Who may do what.
 *
 * Pure functions, so the rules can be exercised exhaustively without a
 * database. Deliberately small: this owns the platform-wide question — does
 * this Viewer hold this capability — and nothing else. Resource rules such as
 * Moment visibility, blocking, and Location precision stay close to the
 * features that own them (`authorization.md:418-422`); absorbing them here
 * would produce exactly the giant condition tree the architecture warns
 * against.
 */

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
  // Four capabilities rather than one, so that reviewing reports, deciding what
  // is distributed, suspending an account, and judging appeals can be held
  // separately. Somebody triaging a queue does not need the power to suspend,
  // and an appeal decided by whoever made the original decision is not much of
  // an appeal — separating them is what makes either arrangement possible
  // later without redefining the role.
  moderator: [
    "moderation:report-review",
    "moderation:content-moderate",
    "moderation:account-suspend",
    "moderation:appeal-review",
  ],
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

/**
 * Whether a set of roles confers a permission.
 *
 * Deny is the default: a permission granted by no role is refused, and an
 * unrecognised role contributes nothing rather than being trusted.
 *
 * @param roles - The elevated roles held. The baseline is added here, so
 *   callers pass what is stored rather than remembering to add it.
 * @param required - The permission the action needs.
 * @returns True only if some role grants it.
 */
export function hasPermission(roles: readonly Role[], required: Permission): boolean {
  return permissionsFor(effectiveRoles(roles)).includes(required);
}

/**
 * Whether someone may grant a role to the account named.
 *
 * The one rule that is about the act rather than the actor's capability, and
 * the reason it lives here rather than in a route: no future caller can reach
 * a grant without passing through this (`authorization.md` invariant 22).
 *
 * @param actorUserId - Who is granting. Undefined means the command line,
 *   where no User is acting and there is no self to escalate to.
 * @param subjectUserId - Who would hold the role.
 * @returns True if the grant is permissible. False only for self-escalation: a
 *   User must never be able to raise their own privileges, however the request
 *   reaches the server. Removal is deliberately not symmetrical and needs no
 *   rule of its own — the prohibition is about escalation, and an
 *   administrator standing down should not need a second administrator.
 */
export function mayGrantRole(actorUserId: string | undefined, subjectUserId: string): boolean {
  return actorUserId === undefined || actorUserId !== subjectUserId;
}
