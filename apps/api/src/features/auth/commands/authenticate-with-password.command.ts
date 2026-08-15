import type { Command } from "../../../types/command.js";

/** Sign in with an address and a password. */
export type AuthenticateWithPasswordCommand = Command<
  "AuthenticateWithPassword",
  { email: string; password: string; clientKind: string | undefined }
>;

/**
 * Sign in with a password.
 *
 * @param email - The address as typed.
 * @param password - The submitted plaintext.
 * @param clientKind - A short description of the client, when it sent one.
 * @returns The command.
 */
export function authenticateWithPassword(
  email: string,
  password: string,
  clientKind: string | undefined,
): AuthenticateWithPasswordCommand {
  return { type: "AuthenticateWithPassword", payload: { email, password, clientKind } };
}
