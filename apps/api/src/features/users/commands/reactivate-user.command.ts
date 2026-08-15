import type { Command } from "../../../types/command.js";

/** Bring a deactivated account back. */
export type ReactivateUserCommand = Command<"ReactivateUser", { userId: string }>;

/**
 * Build a {@link ReactivateUserCommand}.
 *
 * @param userId - Whose account.
 * @returns The command.
 */
export function reactivateUser(userId: string): ReactivateUserCommand {
  return { type: "ReactivateUser", payload: { userId } };
}
