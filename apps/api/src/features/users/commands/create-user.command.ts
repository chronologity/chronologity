import type { Command } from "../../../types/command.js";

/** Complete account creation. */
export type CreateUserCommand = Command<
  "CreateUser",
  {
    identityId: string;
    handle: string;
    displayName: string;
    biography: string | undefined;
    /** Required: a minimum age cannot be enforced without it. */
    dateOfBirth: string;
  }
>;

/**
 * Build a {@link CreateUserCommand}.
 *
 * @param identityId - The authenticated Identity this account will belong to.
 * @param input - The chosen handle, display name, date of birth, and optional
 *   biography.
 * @returns The command.
 */
export function createUser(
  identityId: string,
  input: {
    handle: string;
    displayName: string;
    biography?: string | undefined;
    dateOfBirth: string;
  },
): CreateUserCommand {
  return {
    type: "CreateUser",
    payload: {
      identityId,
      handle: input.handle,
      displayName: input.displayName,
      biography: input.biography,
      dateOfBirth: input.dateOfBirth,
    },
  };
}
