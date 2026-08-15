import type { UpdatePreferencesRequest } from "@chronologity/contracts";
import type { Command } from "../../../types/command.js";

/** Change preferences. */
export type UpdatePreferencesCommand = Command<
  "UpdatePreferences",
  { userId: string; preferences: UpdatePreferencesRequest }
>;

/**
 * Build an {@link UpdatePreferencesCommand}.
 *
 * @param userId - Whose preferences.
 * @param preferences - Only those being changed; the rest are left alone.
 * @returns The command.
 */
export function updatePreferences(
  userId: string,
  preferences: UpdatePreferencesRequest,
): UpdatePreferencesCommand {
  return { type: "UpdatePreferences", payload: { userId, preferences } };
}
