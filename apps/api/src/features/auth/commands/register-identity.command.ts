import type { Command } from "../../../types/command.js";

/** Register with an address and a password. */
export type RegisterIdentityCommand = Command<
  "RegisterIdentity",
  { email: string; password: string }
>;

/**
 * Register an address with a password.
 *
 * @param email - The address as typed, unproven until a link is redeemed.
 * @param password - The proposed plaintext, checked against policy before
 *   anything is written.
 * @returns The command.
 */
export function registerIdentity(email: string, password: string): RegisterIdentityCommand {
  return { type: "RegisterIdentity", payload: { email, password } };
}
