import type { Command } from "../../../types/command.js";

/** Ask for a password reset link. */
export type RequestPasswordResetCommand = Command<"RequestPasswordReset", { email: string }>;

/**
 * Ask for a password reset link.
 *
 * @param email - The address to send a reset link to.
 * @returns The command.
 */
export function requestPasswordReset(email: string): RequestPasswordResetCommand {
  return { type: "RequestPasswordReset", payload: { email } };
}
