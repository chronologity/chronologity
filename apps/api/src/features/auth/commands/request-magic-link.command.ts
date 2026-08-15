import type { Command } from "../../../types/command.js";

/** Ask for a sign-in link to be sent to an address. */
export type RequestMagicLinkCommand = Command<"RequestMagicLink", { email: string }>;

/**
 * Ask for a sign-in link.
 *
 * @param email - The address as typed. Normalisation happens where identities
 *   are resolved, not here.
 * @returns The command.
 */
export function requestMagicLink(email: string): RequestMagicLinkCommand {
  return { type: "RequestMagicLink", payload: { email } };
}
