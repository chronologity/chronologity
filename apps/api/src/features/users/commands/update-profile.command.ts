import type { Command } from "../../../types/command.js";

/** Change how a User presents themselves. */
export type UpdateProfileCommand = Command<
  "UpdateProfile",
  {
    userId: string;
    displayName: string | undefined;
    /** Null clears the biography; undefined leaves it alone. */
    biography: string | null | undefined;
  }
>;

/**
 * Build an {@link UpdateProfileCommand}.
 *
 * @param userId - Whose profile.
 * @param input - The fields to change.
 * @returns The command.
 */
export function updateProfile(
  userId: string,
  input: { displayName?: string | undefined; biography?: string | null | undefined },
): UpdateProfileCommand {
  return {
    type: "UpdateProfile",
    payload: { userId, displayName: input.displayName, biography: input.biography },
  };
}
