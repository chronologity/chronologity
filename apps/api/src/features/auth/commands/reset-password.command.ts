import type { Command } from "../../../types/command.js";

/** Set a new password using an emailed reset link. */
export type ResetPasswordCommand = Command<"ResetPassword", { token: string; password: string }>;

export function resetPassword(token: string, password: string): ResetPasswordCommand {
  return { type: "ResetPassword", payload: { token, password } };
}
