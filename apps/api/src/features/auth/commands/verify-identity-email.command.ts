import type { Command } from "../../../types/command.js";

/** Prove control of a registered address. */
export type VerifyIdentityEmailCommand = Command<"VerifyIdentityEmail", { token: string }>;

/**
 * Prove control of a registered address.
 *
 * @param token - The raw token from the verification link.
 * @returns The command.
 */
export function verifyIdentityEmail(token: string): VerifyIdentityEmailCommand {
  return { type: "VerifyIdentityEmail", payload: { token } };
}
