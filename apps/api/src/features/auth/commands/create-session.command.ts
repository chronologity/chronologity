import type { Command } from "../../../types/command.js";

/** Redeem a sign-in link for a Session. */
export type CreateSessionCommand = Command<
  "CreateSession",
  { token: string; clientKind: string | undefined }
>;

/**
 * Redeem a sign-in link.
 *
 * @param token - The raw token from the emailed link.
 * @param clientKind - A short description of the client, when it sent one.
 * @returns The command.
 */
export function createSession(token: string, clientKind: string | undefined): CreateSessionCommand {
  return { type: "CreateSession", payload: { token, clientKind } };
}
