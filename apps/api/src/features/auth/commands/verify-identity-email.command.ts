import type { Command } from "../../../types/command.js";

/** Prove control of a registered address. */
export type VerifyIdentityEmailCommand = Command<"VerifyIdentityEmail", { token: string }>;

export function verifyIdentityEmail(token: string): VerifyIdentityEmailCommand {
  return { type: "VerifyIdentityEmail", payload: { token } };
}
