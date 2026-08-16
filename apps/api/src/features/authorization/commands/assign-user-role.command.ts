import type { GrantableRole } from "@chronologity/contracts";
import type { Command } from "../../../types/command.js";

/** Grant an elevated role. */
export type AssignUserRoleCommand = Command<
  "AssignUserRole",
  {
    userId: string;
    role: GrantableRole;
    /** Absent only for the CLI, where no User is acting. */
    assignedBy: string | undefined;
    reason: string | undefined;
  }
>;

/**
 * Build an {@link AssignUserRoleCommand}.
 *
 * @param userId - Who is to hold the role.
 * @param role - Which role.
 * @param assignedBy - Who is granting it, or undefined for the CLI.
 * @param reason - Why, recorded in the audit trail.
 * @returns The command.
 */
export function assignUserRole(
  userId: string,
  role: GrantableRole,
  assignedBy: string | undefined,
  reason?: string | undefined,
): AssignUserRoleCommand {
  return { type: "AssignUserRole", payload: { userId, role, assignedBy, reason } };
}
