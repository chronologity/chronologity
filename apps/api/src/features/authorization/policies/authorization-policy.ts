import type { Permission, Role } from "@chronologity/contracts";
import { effectiveRoles, permissionsFor } from "./role-permissions.js";

/**
 * The authorization decision.
 *
 * Deliberately small. This module owns the platform-wide question — does this
 * Viewer hold this capability — and nothing else. Resource rules such as
 * Moment visibility, blocking, and Location precision stay close to the
 * features that own them (`authorization.md:418-422`); absorbing them here
 * would produce exactly the giant condition tree the architecture warns
 * against.
 */

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
