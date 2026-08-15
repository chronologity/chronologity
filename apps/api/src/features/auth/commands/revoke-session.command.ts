import type { Command } from "../../../types/command.js";

/** End one Session. */
export type RevokeSessionCommand = Command<
  "RevokeSession",
  { sessionId: string; identityId: string; reason: string }
>;

/**
 * End one Session.
 *
 * @param sessionId - Which Session to end.
 * @param identityId - Who is asking; a Session belonging to someone else is
 *   refused as though it did not exist.
 * @param reason - Recorded, because a logout and a suspected theft end the same
 *   way but mean different things afterwards.
 * @returns The command.
 */
export function revokeSession(
  sessionId: string,
  identityId: string,
  reason: string,
): RevokeSessionCommand {
  return { type: "RevokeSession", payload: { sessionId, identityId, reason } };
}
