import type { Command } from "../../../types/command.js";

/** End one Session. */
export type RevokeSessionCommand = Command<
  "RevokeSession",
  { sessionId: string; identityId: string; reason: string }
>;

export function revokeSession(
  sessionId: string,
  identityId: string,
  reason: string,
): RevokeSessionCommand {
  return { type: "RevokeSession", payload: { sessionId, identityId, reason } };
}
