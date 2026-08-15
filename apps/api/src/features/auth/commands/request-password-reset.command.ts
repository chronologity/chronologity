import type { Command } from "../../../types/command.js";

/** Ask for a password reset link. */
export type RequestPasswordResetCommand = Command<"RequestPasswordReset", { email: string }>;

export function requestPasswordReset(email: string): RequestPasswordResetCommand {
  return { type: "RequestPasswordReset", payload: { email } };
}
