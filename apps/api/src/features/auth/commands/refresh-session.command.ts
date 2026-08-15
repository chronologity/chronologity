import type { Command } from "../../../types/command.js";

/** Exchange a refresh credential for a new pair. */
export type RefreshSessionCommand = Command<
  "RefreshSession",
  { sessionId: string; refreshToken: string }
>;

/**
 * Exchange a refresh credential for a new pair.
 *
 * @param sessionId - Which Session to refresh.
 * @param refreshToken - The credential proving the right to refresh it.
 * @returns The command.
 */
export function refreshSession(sessionId: string, refreshToken: string): RefreshSessionCommand {
  return { type: "RefreshSession", payload: { sessionId, refreshToken } };
}
