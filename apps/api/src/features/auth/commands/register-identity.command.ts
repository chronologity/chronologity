import type { Command } from "../../../types/command.js";

/** Register with an address and a password. */
export type RegisterIdentityCommand = Command<
  "RegisterIdentity",
  { email: string; password: string }
>;

export function registerIdentity(email: string, password: string): RegisterIdentityCommand {
  return { type: "RegisterIdentity", payload: { email, password } };
}
