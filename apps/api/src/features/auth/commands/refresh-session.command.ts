import type { Command } from "../../../types/command.js";

/** Exchange a refresh credential for a new pair. */
export type RefreshSessionCommand = Command<
  "RefreshSession",
  { sessionId: string; refreshToken: string }
>;

export function refreshSession(sessionId: string, refreshToken: string): RefreshSessionCommand {
  return { type: "RefreshSession", payload: { sessionId, refreshToken } };
}
