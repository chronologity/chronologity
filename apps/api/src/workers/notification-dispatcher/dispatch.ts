import type { Notification } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import type {
  ClaimedDelivery,
  NotificationDeliveryRepository,
} from "../../features/notifications/notification.delivery.repository.js";
import {
  composeDigest,
  composeEmail,
  composePush,
  type Message,
} from "../../features/notifications/notification.messages.js";
import type { RecipientDirectory } from "../../features/notifications/notification.recipients.js";
import type { NotificationService } from "../../features/notifications/notification.service.js";
import type { EmailClient } from "../../integrations/email/email-client.js";
import { PushError, type PushClient } from "../../integrations/push/push-client.js";
import { withTransaction, type Transaction } from "../../lib/database/transaction.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import type { Logger } from "../../lib/logger/logger.js";

/**
 * Sending what has come due.
 *
 * Deliberately the only place in this feature that talks to a provider, and
 * deliberately not in the path of anything that causes a notification.
 * `architecture/notifications.md:840` requires that provider delivery never
 * block a reaction, a Moment, a moderation decision, or a session revocation,
 * and a row in a table is the seam that guarantees it: the service that caused
 * the notification writes the row and returns, and if every provider is down
 * the only consequence is that the row is still there.
 *
 * **Composition happens here, not when the delivery was created.** Each message
 * is built from `NotificationService.open`, which resolves the recipient's
 * access again — so a Moment made private while an email sat in the queue means
 * the email is not sent. Composing earlier would have stored the words, and the
 * words cannot be unsent once they are in a mailbox. This is the same rule the
 * in-app list reads by, applied where it costs more to get wrong.
 */

export interface DispatchOptions {
  readonly dataSource: DataSource;
  readonly deliveries: NotificationDeliveryRepository;
  /** Composes, and reauthorizes while composing. */
  readonly notifications: NotificationService;
  readonly recipients: RecipientDirectory;
  readonly email: EmailClient;
  readonly push: PushClient;
  /** How many deliveries to take at once. */
  readonly batchSize?: number;
  /** How many attempts a transient failure is given before it is set aside. */
  readonly maximumAttempts?: number;
  /** The first retry delay; each further attempt doubles it. */
  readonly retryBackoffMs?: number;
  readonly now?: () => Date;
  readonly logger?: Logger;
}

export interface DispatchResult {
  readonly sent: number;
  /** Deliveries that stopped being something the recipient may see. */
  readonly cancelled: number;
  readonly failed: number;
  /** Deliveries given up on after repeated transient failures. */
  readonly abandoned: number;
  /**
   * Whether everything due has been dealt with.
   *
   * Distinct from having sent nothing: a pass that filled its batch has almost
   * certainly left more behind and should run again at once, while a pass that
   * found nothing should wait.
   */
  readonly reachedEnd: boolean;
}

const DEFAULT_BATCH_SIZE = 50;

/**
 * How many attempts a transient failure is given.
 *
 * The outbox's number, for the same reason: high enough that an ordinary
 * provider outage never reaches it, low enough that a delivery which can never
 * be sent stops being retried the same day.
 */
const DEFAULT_MAXIMUM_ATTEMPTS = 10;

/** The first retry delay. Doubles with each attempt. */
const DEFAULT_RETRY_BACKOFF_MS = 30_000;

/** How long a retry is ever put off, however many attempts have failed. */
const MAXIMUM_BACKOFF_MS = 6 * 60 * 60 * 1_000;

/** A delivery and the notification it turned out to be carrying. */
interface Composed {
  readonly delivery: ClaimedDelivery;
  readonly notification: Notification;
}

/** Everything going out in one message. */
interface Group {
  readonly recipientUserId: string;
  readonly channel: "email" | "push";
  readonly members: Composed[];
}

/**
 * Send one batch of deliveries that have come due.
 *
 * @param options - Database, repository, composition, providers, batch size,
 *   attempt limit, backoff, clock, and an optional logger.
 * @returns How many were sent, cancelled, failed, and abandoned, and whether
 *   the queue is now empty.
 * @throws {Error} If the database could not be reached. A provider failure is
 *   recorded against the deliveries and does not throw: the rows stay pending
 *   and the next pass tries again, which is what the queue is for.
 */
export async function dispatchDueDeliveries(
  options: DispatchOptions,
): Promise<DispatchResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const now = options.now ?? (() => new Date());
  const at = now();

  // The batch is sent inside the transaction that claimed it, following the
  // outbox publisher. That makes delivery at-least-once: a crash between a
  // provider accepting a message and the commit re-sends it rather than losing
  // it, and a duplicate email is a far smaller harm than silence about a
  // password change. The cost is a transaction held open across provider calls,
  // which is why the batch is small and why the locks it holds are on delivery
  // rows that other dispatchers skip past.
  return withTransaction(options.dataSource, async (tx) => {
    const claimed = await options.deliveries.claimDue(tx, at, batchSize);

    if (claimed.length === 0) {
      return { sent: 0, cancelled: 0, failed: 0, abandoned: 0, reachedEnd: true };
    }

    const { composed, cancelled } = await compose(options, claimed);

    await options.deliveries.markCancelled(tx, cancelled, at);

    let sent = 0;
    let failed = 0;
    let abandoned = 0;
    let stillCancelled = cancelled.length;

    for (const group of gather(composed)) {
      const outcome = await deliver(options, tx, group, at);

      sent += outcome.sent;
      failed += outcome.failed;
      abandoned += outcome.abandoned;
      stillCancelled += outcome.cancelled;
    }

    return {
      sent,
      cancelled: stillCancelled,
      failed,
      abandoned,
      reachedEnd: claimed.length < batchSize,
    };
  });
}

/**
 * Turn claimed deliveries into notifications the recipient may still see.
 *
 * @param options - Where composition happens.
 * @param claimed - The batch.
 * @returns Those that still render, and the identifiers of those that do not.
 *   A notification the recipient may no longer see produces no message and is
 *   cancelled rather than failed: nothing went wrong, the thing simply stopped
 *   being theirs to know about.
 */
async function compose(
  options: DispatchOptions,
  claimed: readonly ClaimedDelivery[],
): Promise<{ composed: Composed[]; cancelled: string[] }> {
  const composed: Composed[] = [];
  const cancelled: string[] = [];

  for (const delivery of claimed) {
    try {
      composed.push({
        delivery,
        notification: await options.notifications.open(
          delivery.notificationId,
          delivery.recipientUserId,
        ),
      });
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        // Not a privacy outcome. Something is wrong with the database or the
        // code, and swallowing it here would silently cancel real deliveries.
        throw error;
      }

      options.logger?.info(
        { deliveryId: delivery.deliveryId, channel: delivery.channel },
        "Delivery cancelled: the recipient may no longer see what it is about",
      );

      cancelled.push(delivery.deliveryId);
    }
  }

  return { composed, cancelled };
}

/**
 * Decide what travels together.
 *
 * @param composed - Everything in this batch that still renders.
 * @returns The groups. A digest gathers everything for one person on one
 *   channel into a single message; anything else travels alone, because its
 *   mode was recorded as immediate when it was scheduled — which is what stops
 *   two things happening in the same second from being silently summarised, and
 *   what keeps a required notification out of a digest.
 */
function gather(composed: readonly Composed[]): Group[] {
  const groups = new Map<string, Group>();

  for (const entry of composed) {
    const key =
      entry.delivery.mode === "digest"
        ? `digest:${entry.delivery.recipientUserId}:${entry.delivery.channel}`
        : `alone:${entry.delivery.deliveryId}`;

    const existing = groups.get(key);

    if (existing === undefined) {
      groups.set(key, {
        recipientUserId: entry.delivery.recipientUserId,
        channel: entry.delivery.channel,
        members: [entry],
      });
    } else {
      existing.members.push(entry);
    }
  }

  return [...groups.values()];
}

/**
 * Send one group, and record what happened to it.
 *
 * @param options - Providers and repository.
 * @param tx - The transaction the batch was claimed in.
 * @param group - What is going out together.
 * @param at - The instant this pass began.
 * @returns How the group's deliveries ended up.
 */
async function deliver(
  options: DispatchOptions,
  tx: Transaction,
  group: Group,
  at: Date,
): Promise<{ sent: number; cancelled: number; failed: number; abandoned: number }> {
  const ids = group.members.map((member) => member.delivery.deliveryId);
  const message = wordsFor(group);

  if (message === undefined) {
    // Nothing this channel has wording for, which happens when a vocabulary has
    // grown past this deployment. Cancelled rather than retried: the next pass
    // would compose exactly the same nothing.
    await options.deliveries.markCancelled(tx, ids, at);

    return { sent: 0, cancelled: ids.length, failed: 0, abandoned: 0 };
  }

  try {
    const reached =
      group.channel === "email"
        ? await sendEmail(options, group, message)
        : await sendPush(options, tx, group, message, at);

    if (!reached) {
      // Nowhere left to send. Not a failure and not something to retry: the
      // address or every device went away between scheduling and sending.
      await options.deliveries.markCancelled(tx, ids, at);

      return { sent: 0, cancelled: ids.length, failed: 0, abandoned: 0 };
    }

    await options.deliveries.markSent(tx, ids, at);

    return { sent: ids.length, cancelled: 0, failed: 0, abandoned: 0 };
  } catch (error) {
    const category = classify(error);
    const attempts = Math.max(...group.members.map((member) => member.delivery.attempts)) + 1;
    const maximumAttempts = options.maximumAttempts ?? DEFAULT_MAXIMUM_ATTEMPTS;
    const givingUp = category === "permanent" || attempts >= maximumAttempts;

    // Never the message and never the token: a delivery record is read by
    // whoever is investigating a provider, and neither belongs in front of them.
    options.logger?.[givingUp ? "error" : "warn"](
      {
        channel: group.channel,
        deliveries: ids.length,
        attempts,
        category,
        err: error instanceof Error ? error.message : String(error),
      },
      givingUp ? "Delivery will not be retried" : "Delivery failed and will be retried",
    );

    await options.deliveries.recordFailure(tx, ids, {
      category,
      error: describe(error),
      at,
      retryAt: retryAfter(at, attempts, options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS),
      maximumAttempts,
    });

    if (category === "permanent") {
      return { sent: 0, cancelled: 0, failed: ids.length, abandoned: 0 };
    }

    return {
      sent: 0,
      cancelled: 0,
      failed: 0,
      abandoned: givingUp ? ids.length : 0,
    };
  }
}

/**
 * The words for a group, on the channel it is going out on.
 *
 * @param group - What is going out together.
 * @returns The message, or undefined when nothing in the group could be worded.
 *   Email names the people the recipient is entitled to know about; push counts
 *   them instead, because a lock screen is visible to whoever is standing
 *   nearby.
 */
function wordsFor(group: Group): Message | undefined {
  const names = group.channel === "email";

  if (group.members.length > 1) {
    return composeDigest(
      group.members.map((member) => member.notification),
      names,
    );
  }

  const only = group.members[0];

  if (only === undefined) {
    return undefined;
  }

  return names ? composeEmail(only.notification) : composePush(only.notification);
}

/**
 * Send one group by email.
 *
 * @param options - Providers and the directory.
 * @param group - What is going out.
 * @param message - The words.
 * @returns Whether there was anywhere to send. False when the account no longer
 *   has a verified address, which is a cancellation rather than a failure.
 * @throws {Error} Whatever the provider threw, for the caller to classify.
 */
async function sendEmail(
  options: DispatchOptions,
  group: Group,
  message: Message,
): Promise<boolean> {
  const address = await options.recipients.emailFor(group.recipientUserId);

  if (address === undefined) {
    return false;
  }

  await options.email.send({ to: address, subject: message.subject, text: message.body });

  return true;
}

/**
 * Send one group by push, to every device the account has.
 *
 * @param options - Providers and repository.
 * @param tx - The transaction, used to retire a device the provider refuses.
 * @param group - What is going out.
 * @param message - The words.
 * @param at - The instant this pass began.
 * @returns Whether any device took it. False when the account has no active
 *   device left, or every one of them was refused — in both cases there is
 *   nothing to retry.
 * @throws {PushError} If the provider failed in a way that is not about one
 *   device, so the caller can decide whether to try again.
 */
async function sendPush(
  options: DispatchOptions,
  tx: Transaction,
  group: Group,
  message: Message,
  at: Date,
): Promise<boolean> {
  const devices = await options.deliveries.activeDevicesForSending(group.recipientUserId);

  if (devices.length === 0) {
    return false;
  }

  let reached = 0;

  for (const device of devices) {
    try {
      await options.push.send(device, { title: message.subject, body: message.body });

      reached += 1;
    } catch (error) {
      if (error instanceof PushError && error.reason === "invalidToken") {
        // The provider has told us this token is dead. Retiring the device is
        // the whole of the response `architecture/notifications.md:826` asks
        // for — retrying it is what turns one uninstalled application into a
        // delivery that never stops being attempted.
        await options.deliveries.invalidateRejectedDevice(tx, device.deviceId, at);

        options.logger?.info(
          { deviceId: device.deviceId, platform: device.platform },
          "Device retired: the provider refused its token",
        );

        continue;
      }

      throw error;
    }
  }

  // Every device refused. Nothing is left to send to and nothing would be
  // different next time, so this is an end rather than a retry.
  return reached > 0;
}

/**
 * Whether a failure is worth trying again.
 *
 * @param error - Whatever was thrown.
 * @returns `permanent` where trying again cannot help — a provider that refused
 *   the message rather than failed to take it — and `transient` otherwise.
 *   Anything unrecognised is read as transient, which errs towards delivering
 *   late rather than not at all; the attempt ceiling means an unrecognised
 *   permanent failure still stops, a few attempts later.
 */
function classify(error: unknown): "transient" | "permanent" {
  if (error instanceof PushError) {
    return error.reason === "permanent" ? "permanent" : "transient";
  }

  // SMTP says so itself: a 5xx is a refusal and a 4xx is a request to come
  // back. `nodemailer` passes the code through unchanged.
  const code = (error as { responseCode?: unknown }).responseCode;

  return typeof code === "number" && code >= 500 && code < 600 ? "permanent" : "transient";
}

/**
 * Describe a failure for the delivery record.
 *
 * @param error - Whatever was thrown.
 * @returns A short description, bounded so a provider that returns a page of
 *   HTML does not put it in a column somebody later reads.
 */
function describe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/**
 * When to try again.
 *
 * @param at - Now.
 * @param attempts - How many attempts have now failed.
 * @param backoffMs - The first delay.
 * @returns The next due time, doubling with each attempt and capped — an
 *   unbounded doubling reaches days, and a delivery due in three days is a
 *   delivery nobody will ever see.
 */
function retryAfter(at: Date, attempts: number, backoffMs: number): Date {
  const delay = Math.min(backoffMs * 2 ** Math.max(0, attempts - 1), MAXIMUM_BACKOFF_MS);

  return new Date(at.getTime() + delay);
}
