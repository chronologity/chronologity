import type { Command } from "../../../types/command.js";

/** End every Session belonging to an Identity. */
export type RevokeAllUserSessionsCommand = Command<
  "RevokeAllUserSessions",
  { identityId: string; reason: string }
>;

/**
 * End every Session an Identity has open.
 *
 * @param identityId - Whose Sessions to end.
 * @param reason - Why.
 * @returns The command.
 */
export function revokeAllUserSessions(
  identityId: string,
  reason: string,
): RevokeAllUserSessionsCommand {
  return { type: "RevokeAllUserSessions", payload: { identityId, reason } };
}
