import type { Command } from "../../../types/command.js";

/** Change a password while signed in. */
export type ChangePasswordCommand = Command<
  "ChangePassword",
  {
    identityId: string;
    currentSessionId: string;
    currentPassword: string;
    newPassword: string;
  }
>;

export function changePassword(input: {
  identityId: string;
  currentSessionId: string;
  currentPassword: string;
  newPassword: string;
}): ChangePasswordCommand {
  return { type: "ChangePassword", payload: input };
}
