import type { Command } from "../../../types/command.js";

/** Sign in with an address and a password. */
export type AuthenticateWithPasswordCommand = Command<
  "AuthenticateWithPassword",
  { email: string; password: string; clientKind: string | undefined }
>;

export function authenticateWithPassword(
  email: string,
  password: string,
  clientKind: string | undefined,
): AuthenticateWithPasswordCommand {
  return { type: "AuthenticateWithPassword", payload: { email, password, clientKind } };
}
