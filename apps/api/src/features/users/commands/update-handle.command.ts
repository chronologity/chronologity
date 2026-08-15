import type { Command } from "../../../types/command.js";

/** Take a new handle. */
export type UpdateHandleCommand = Command<"UpdateHandle", { userId: string; handle: string }>;

/**
 * Build an {@link UpdateHandleCommand}.
 *
 * @param userId - Whose handle.
 * @param handle - The new handle, as typed.
 * @returns The command.
 */
export function updateHandle(userId: string, handle: string): UpdateHandleCommand {
  return { type: "UpdateHandle", payload: { userId, handle } };
}
