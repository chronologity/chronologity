import type { Logger } from "../../lib/logger/logger.js";

/**
 * Outbound text messages.
 *
 * An adapter, not a domain authority: it delivers what it is given and decides
 * nothing, exactly like `email-client.ts` beside it.
 *
 * There is no provider yet. Sending a real text needs an account with a carrier
 * gateway, and until one exists this records what would have been sent rather
 * than pretending to have sent it. That is the honest local behaviour — the
 * same shape email has, where local development points at Mailpit rather than
 * at a real mail provider.
 *
 * **Where the reassignment check belongs.** When there is a provider, it can
 * also answer whether a number was recently reassigned or its SIM recently
 * swapped — the two failures dormancy cannot see. That question is asked at the
 * moment a code is sent, which is here, and adding it changes this adapter
 * rather than anything that calls it.
 */
export interface SmsMessage {
  /** The number in E.164. */
  readonly to: string;
  readonly text: string;
}

export interface SmsClient {
  send(message: SmsMessage): Promise<void>;
}

/**
 * Build the outbound SMS adapter.
 *
 * @param logger - Optional. The recipient is logged; the message is not, since
 *   a sign-in code in a log file is a working credential.
 * @returns A client that records what it was asked to send.
 */
export function createSmsClient(logger?: Logger): SmsClient {
  return {
    async send(message) {
      // Deliberately not the text. A code written to a log is a credential
      // lying in a file, which is the thing hashing it in the database was for.
      logger?.info({ to: message.to }, "Text message not sent: no provider is configured");

      return Promise.resolve();
    },
  };
}
