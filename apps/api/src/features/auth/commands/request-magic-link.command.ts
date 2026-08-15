import type { Command } from "../../../types/command.js";

/** Ask for a sign-in link to be sent to an address. */
export type RequestMagicLinkCommand = Command<"RequestMagicLink", { email: string }>;

export function requestMagicLink(email: string): RequestMagicLinkCommand {
  return { type: "RequestMagicLink", payload: { email } };
}
