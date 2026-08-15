import type { Command } from "../../../types/command.js";

/** Redeem a sign-in link for a Session. */
export type CreateSessionCommand = Command<
  "CreateSession",
  { token: string; clientKind: string | undefined }
>;

export function createSession(token: string, clientKind: string | undefined): CreateSessionCommand {
  return { type: "CreateSession", payload: { token, clientKind } };
}
