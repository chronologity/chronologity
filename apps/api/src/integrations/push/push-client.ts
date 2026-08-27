import type { Logger } from "../../lib/logger/logger.js";

/**
 * Outbound push notifications.
 *
 * An adapter, not a domain authority: it delivers what it is given and decides
 * nothing, exactly like `email-client.ts` and `sms-client.ts` beside it.
 *
 * There is no provider yet. Sending a real push needs credentials for APNs or
 * FCM and a physical device to send to, and until those exist this records what
 * would have been sent rather than pretending to have sent it. Everything
 * around it is real — devices register, tokens are stored and retired,
 * deliveries are scheduled, quiet hours apply, retries are bounded — so adding
 * a provider later changes this file and nothing that calls it.
 *
 * **Where token rejection belongs.** A real provider answers a send with a
 * verdict on the token: accepted, or gone because the application was
 * uninstalled. That answer arrives here, and turning it into
 * `PushError` with `invalidToken` is this adapter's job — the dispatcher
 * already knows what to do with one, so a provider arriving needs no change
 * there.
 */

/** A device to send to. */
export interface PushTarget {
  /** Which device, so a rejection can be attributed to the right one. */
  readonly deviceId: string;
  readonly platform: string;
  /**
   * The provider credential.
   *
   * Never logged. Anybody holding it can send to that device, which is the
   * whole reason `architecture/notifications.md:915` asks that these not be
   * logged broadly.
   */
  readonly token: string;
}

/** What to put on the screen. */
export interface PushMessage {
  readonly title: string;
  readonly body: string;
}

/** Why a push did not go. */
export type PushRejection = "transient" | "permanent" | "invalidToken";

/** A push the provider refused. */
export class PushError extends Error {
  /**
   * Build a push failure.
   *
   * @param reason - Whether to try again, give up, or retire the device.
   * @param message - What went wrong, for the delivery record. Never the token.
   */
  constructor(
    readonly reason: PushRejection,
    message: string,
  ) {
    super(message);
    this.name = "PushError";
  }
}

export interface PushClient {
  send(target: PushTarget, message: PushMessage): Promise<void>;
}

/**
 * Build the outbound push adapter.
 *
 * @param logger - Optional. The device is logged; the token is not, and neither
 *   is the message body — a push body is the one piece of notification text
 *   written for a surface other people can see, and copying it into a log file
 *   spreads it further than the lock screen ever would.
 * @returns A client that records what it was asked to send.
 */
export function createPushClient(logger?: Logger): PushClient {
  return {
    async send(target, message) {
      // Deliberately neither the token nor the body. The identifiers here are
      // enough to follow one push through the logs and are useless to anybody
      // who reads them.
      logger?.info(
        { deviceId: target.deviceId, platform: target.platform, title: message.title },
        "Push not sent: no provider is configured",
      );

      return Promise.resolve();
    },
  };
}
