import type { Command } from "../../../types/command.js";

/** End every Session belonging to an Identity. */
export type RevokeAllUserSessionsCommand = Command<
  "RevokeAllUserSessions",
  { identityId: string; reason: string }
>;

export function revokeAllUserSessions(
  identityId: string,
  reason: string,
): RevokeAllUserSessionsCommand {
  return { type: "RevokeAllUserSessions", payload: { identityId, reason } };
}
