import type { Command } from "../../../types/command.js";

/** Set a new password using an emailed reset link. */
export type ResetPasswordCommand = Command<"ResetPassword", { token: string; password: string }>;

/**
 * Set a new password using a reset link.
 *
 * @param token - The raw token from the reset link.
 * @param password - The proposed new plaintext.
 * @returns The command.
 */
export function resetPassword(token: string, password: string): ResetPasswordCommand {
  return { type: "ResetPassword", payload: { token, password } };
}
