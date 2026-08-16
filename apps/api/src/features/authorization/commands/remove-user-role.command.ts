import type { GrantableRole } from "@chronologity/contracts";
import type { Command } from "../../../types/command.js";

/** Take an elevated role away. */
export type RemoveUserRoleCommand = Command<
  "RemoveUserRole",
  {
    userId: string;
    role: GrantableRole;
    /** Absent only for the CLI, where no User is acting. */
    removedBy: string | undefined;
    reason: string | undefined;
  }
>;

/**
 * Build a {@link RemoveUserRoleCommand}.
 *
 * @param userId - Who is losing the role.
 * @param role - Which role.
 * @param removedBy - Who is removing it, or undefined for the CLI.
 * @param reason - Why, recorded in the audit trail.
 * @returns The command.
 */
export function removeUserRole(
  userId: string,
  role: GrantableRole,
  removedBy: string | undefined,
  reason?: string | undefined,
): RemoveUserRoleCommand {
  return { type: "RemoveUserRole", payload: { userId, role, removedBy, reason } };
}
