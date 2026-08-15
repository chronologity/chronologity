import type { Command } from "../../../types/command.js";

/** Deactivate an account at its owner's request. */
export type DeactivateUserCommand = Command<
  "DeactivateUser",
  { userId: string; identityId: string }
>;

/**
 * Build a {@link DeactivateUserCommand}.
 *
 * @param userId - Whose account.
 * @param identityId - The Identity behind it, whose Sessions are revoked.
 * @returns The command.
 */
export function deactivateUser(userId: string, identityId: string): DeactivateUserCommand {
  return { type: "DeactivateUser", payload: { userId, identityId } };
}
