import type { DataSource } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import { NotificationDeliverySetting, NotificationDevice } from "./notification.model.js";

/** A delivery claimed for sending, with what it is about. */
export interface ClaimedDelivery {
  readonly deliveryId: string;
  readonly notificationId: string;
  readonly recipientUserId: string;
  readonly channel: "email" | "push";
  readonly mode: "immediate" | "digest";
  readonly attempts: number;
}

/** A device, without the credential that reaches it. */
export interface DeviceView {
  readonly deviceId: string;
  readonly platform: string;
  readonly label: string | null;
  readonly status: string;
  readonly registeredAt: Date;
  readonly lastSeenAt: Date;
}

/**
 * Devices, deliveries, and when a channel delivers.
 *
 * Reads take the DataSource and writes take a transaction, following the
 * repositories beside it.
 *
 * One rule runs through the whole file: a device token goes in and comes back
 * out only where something is about to send to it. `DeviceView` has no field
 * for one, so the register and list paths cannot return a credential even by
 * mistake — the only method that yields a token is the one the dispatcher uses,
 * and it is named to say so.
 */
export class NotificationDeliveryRepository {
  /**
   * Build the delivery repository.
   *
   * @param dataSource - Used for reads. Writes take a transaction.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Register a device, or refresh one already registered.
   *
   * Three cases in one call, because a client cannot tell which of them it is
   * in: a first registration, the same installation reporting in again on
   * launch, and a device that has changed hands.
   *
   * @param tx - The caller's transaction.
   * @param entry - The device, its platform, the provider token, an optional
   *   label, and when.
   * @returns The device as its owner may see it, without the token.
   */
  async registerDevice(
    tx: Transaction,
    entry: {
      deviceId: string;
      userId: string;
      platform: string;
      token: string;
      label: string | undefined;
      at: Date;
    },
  ): Promise<DeviceView> {
    // Anybody else's claim on this token goes first. A phone can be handed on,
    // and `architecture/notifications.md:912` requires that the previous
    // account stops receiving — otherwise two people's private notifications
    // arrive on one lock screen. Done here rather than left to the unique
    // index, because the index would refuse the new registration instead.
    await tx.query(
      `UPDATE notification_devices
          SET status = 'invalidated', invalidated_at = $3
        WHERE token = $1 AND status = 'active' AND user_id <> $2`,
      [entry.token, entry.userId, entry.at],
    );

    // The same installation reporting in again, which is what a client does on
    // every launch. Refreshed rather than duplicated, so a device does not
    // accumulate a row per start-up and receive one push per row.
    //
    // Both statements return the row rather than being read back afterwards. A
    // read through the DataSource would not see what this transaction has
    // written and has not yet committed, so it would find nothing at all.
    //
    // Both are wrapped in a `WITH`. A bare `UPDATE ... RETURNING` through this
    // driver hands back `[rows, count]` rather than rows, and the shape is
    // wrong in a way that types cannot catch — every column reads as undefined
    // instead of the call failing. The repositories beside this one wrap for
    // the same reason.
    const refreshed: StoredDeviceRow[] = await tx.query(
      `WITH refreshed AS (
          UPDATE notification_devices
             SET last_seen_at = $3, platform = $4, label = $5
           WHERE token = $1 AND user_id = $2 AND status = 'active'
       RETURNING device_id, platform, label, status, registered_at, last_seen_at
       ) SELECT * FROM refreshed`,
      [entry.token, entry.userId, entry.at, entry.platform, entry.label ?? null],
    );

    const existing = refreshed[0];

    if (existing !== undefined) {
      return toDeviceView(existing);
    }

    const inserted: StoredDeviceRow[] = await tx.query(
      `WITH opened AS (
          INSERT INTO notification_devices
            (device_id, user_id, platform, token, label, status, registered_at, last_seen_at)
          VALUES ($1, $2, $3, $4, $5, 'active', $6, $6)
       RETURNING device_id, platform, label, status, registered_at, last_seen_at
       ) SELECT * FROM opened`,
      [entry.deviceId, entry.userId, entry.platform, entry.token, entry.label ?? null, entry.at],
    );

    const opened = inserted[0];

    if (opened === undefined) {
      // The insert has no `ON CONFLICT`, so it either returns a row or throws.
      // Saying so is better than inventing a device to satisfy the type.
      throw new Error("The device could not be read back after registering it");
    }

    return toDeviceView(opened);
  }

  /**
   * One device, as its owner may see it.
   *
   * @param deviceId - Which one.
   * @param userId - Who is asking, so nobody reads somebody else's.
   * @returns It without its token, or undefined when there is no such device or
   *   it is not theirs.
   */
  async findDevice(deviceId: string, userId: string): Promise<DeviceView | undefined> {
    const row = await this.dataSource
      .getRepository(NotificationDevice)
      .findOne({ where: { deviceId, userId } });

    return row === null
      ? undefined
      : toDeviceView({
          device_id: row.deviceId,
          platform: row.platform,
          label: row.label,
          status: row.status,
          registered_at: row.registeredAt,
          last_seen_at: row.lastSeenAt,
        });
  }

  /**
   * Retire a device.
   *
   * Retired rather than deleted, so a provider rejection stays distinguishable
   * from a device that was never registered — the difference between "this
   * token is dead" and "this token belongs to somebody else now".
   *
   * @param tx - The caller's transaction.
   * @param deviceId - Which one.
   * @param userId - Whose, so nobody retires somebody else's.
   * @param at - When.
   * @returns Whether it changed. False when it was already retired, which is
   *   success: the desired state holds.
   */
  async invalidateDevice(
    tx: Transaction,
    deviceId: string,
    userId: string,
    at: Date,
  ): Promise<boolean> {
    const rows: { count: number }[] = await tx.query(
      `WITH retired AS (
          UPDATE notification_devices
             SET status = 'invalidated', invalidated_at = $3
           WHERE device_id = $1 AND user_id = $2 AND status = 'active'
       RETURNING 1
       ) SELECT COUNT(*)::int AS count FROM retired`,
      [deviceId, userId, at],
    );

    return (rows[0]?.count ?? 0) > 0;
  }

  /**
   * Retire a device the provider has refused.
   *
   * Separate from the method above and deliberately not asking whose it is: the
   * provider has told us the token is dead, and that is true regardless of who
   * registered it. Retrying it forever is the failure mode
   * `architecture/notifications.md:826` names.
   *
   * @param tx - The caller's transaction.
   * @param deviceId - Which one.
   * @param at - When.
   * @returns Nothing.
   */
  async invalidateRejectedDevice(tx: Transaction, deviceId: string, at: Date): Promise<void> {
    await tx.query(
      `UPDATE notification_devices
          SET status = 'invalidated', invalidated_at = $2
        WHERE device_id = $1 AND status = 'active'`,
      [deviceId, at],
    );
  }

  /**
   * Whether anything could be pushed to at all.
   *
   * @param userId - Whose devices.
   * @returns Whether at least one is active. Asked when scheduling, so a push
   *   delivery is never opened for somebody with nothing to receive it.
   */
  async hasActiveDevice(userId: string): Promise<boolean> {
    return (
      (await this.dataSource
        .getRepository(NotificationDevice)
        .count({ where: { userId, status: "active" } })) > 0
    );
  }

  /**
   * Everywhere a push should go, tokens included.
   *
   * The one method in this file that yields a credential, named so that a
   * reader can see it is. Nothing but the dispatcher calls it.
   *
   * @param userId - Whose devices.
   * @returns The active devices with their tokens, oldest first.
   */
  async activeDevicesForSending(
    userId: string,
  ): Promise<{ deviceId: string; platform: string; token: string }[]> {
    const rows = await this.dataSource
      .getRepository(NotificationDevice)
      .find({ where: { userId, status: "active" }, order: { registeredAt: "ASC" } });

    return rows.map((row) => ({
      deviceId: row.deviceId,
      platform: row.platform,
      token: row.token,
    }));
  }

  /**
   * Open a delivery.
   *
   * @param tx - The caller's transaction.
   * @param entry - Which notification, for whom, on which channel, in which
   *   mode, and when it is due.
   * @returns Whether one was opened. False means a delivery on this channel for
   *   this notification already exists, which is the ordinary consequence of
   *   two things: a notification aggregating while unread, and at-least-once
   *   delivery from the broker. Neither should produce a second email.
   */
  async schedule(
    tx: Transaction,
    entry: {
      deliveryId: string;
      notificationId: string;
      recipientUserId: string;
      channel: string;
      mode: string;
      dueAt: Date;
      at: Date;
    },
  ): Promise<boolean> {
    const opened: { delivery_id: string }[] = await tx.query(
      `INSERT INTO notification_deliveries
         (delivery_id, notification_id, recipient_user_id, channel, mode, status, due_at,
          attempts, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, 0, $7)
       ON CONFLICT (notification_id, channel) DO NOTHING
       RETURNING delivery_id`,
      [
        entry.deliveryId,
        entry.notificationId,
        entry.recipientUserId,
        entry.channel,
        entry.mode,
        entry.dueAt,
        entry.at,
      ],
    );

    return opened.length > 0;
  }

  /**
   * Take a batch of deliveries that have come due.
   *
   * `FOR UPDATE SKIP LOCKED`, following the outbox publisher: several
   * dispatchers may run, and they take disjoint work rather than duplicating
   * each other or queueing behind one slow provider.
   *
   * @param tx - The caller's transaction, held for as long as the batch is
   *   being sent.
   * @param now - The instant to consider due.
   * @param limit - How many at most.
   * @returns The claimed deliveries, oldest due first, so a backlog drains in
   *   the order it accumulated.
   */
  async claimDue(tx: Transaction, now: Date, limit: number): Promise<ClaimedDelivery[]> {
    const rows: {
      delivery_id: string;
      notification_id: string;
      recipient_user_id: string;
      channel: string;
      mode: string;
      attempts: number;
    }[] = await tx.query(
      `SELECT delivery_id, notification_id, recipient_user_id, channel, mode, attempts
         FROM notification_deliveries
        WHERE status = 'pending' AND due_at <= $1
        ORDER BY due_at ASC, delivery_id ASC
        LIMIT $2
          FOR UPDATE SKIP LOCKED`,
      [now, limit],
    );

    return rows.map((row) => ({
      deliveryId: row.delivery_id,
      notificationId: row.notification_id,
      recipientUserId: row.recipient_user_id,
      channel: row.channel as ClaimedDelivery["channel"],
      mode: row.mode as ClaimedDelivery["mode"],
      attempts: row.attempts,
    }));
  }

  /**
   * Record that a batch went out.
   *
   * @param tx - The caller's transaction.
   * @param deliveryIds - Which ones.
   * @param at - When.
   * @returns Nothing.
   */
  async markSent(tx: Transaction, deliveryIds: readonly string[], at: Date): Promise<void> {
    if (deliveryIds.length === 0) {
      return;
    }

    await tx.query(
      `UPDATE notification_deliveries
          SET status = 'sent', completed_at = $2, error_category = NULL, last_error = NULL
        WHERE delivery_id = ANY($1::uuid[]) AND status = 'pending'`,
      [[...deliveryIds], at],
    );
  }

  /**
   * Record that a batch is no longer something to send.
   *
   * Not a failure. This is what happens when the notification stopped being
   * something the recipient may see between its creation and its sending — a
   * Moment made private while an email sat in the queue — and it is kept
   * separate from `failed` so that nobody investigating a provider problem has
   * to sift privacy outcomes out of the results.
   *
   * @param tx - The caller's transaction.
   * @param deliveryIds - Which ones.
   * @param at - When.
   * @returns Nothing.
   */
  async markCancelled(tx: Transaction, deliveryIds: readonly string[], at: Date): Promise<void> {
    if (deliveryIds.length === 0) {
      return;
    }

    await tx.query(
      `UPDATE notification_deliveries
          SET status = 'cancelled', completed_at = $2
        WHERE delivery_id = ANY($1::uuid[]) AND status = 'pending'`,
      [[...deliveryIds], at],
    );
  }

  /**
   * Record that a batch could not be sent.
   *
   * @param tx - The caller's transaction.
   * @param deliveryIds - Which ones.
   * @param failure - Whether it can be retried, what went wrong, when to try
   *   again, and how many attempts are tolerated altogether.
   * @returns Nothing. A permanent failure stops at once; a transient one is
   *   given a later due time until the ceiling, past which it is abandoned —
   *   because a delivery retried forever is not retrying, it is a queue that
   *   never drains.
   */
  async recordFailure(
    tx: Transaction,
    deliveryIds: readonly string[],
    failure: {
      category: "transient" | "permanent";
      error: string;
      at: Date;
      retryAt: Date;
      maximumAttempts: number;
    },
  ): Promise<void> {
    if (deliveryIds.length === 0) {
      return;
    }

    await tx.query(
      `UPDATE notification_deliveries
          SET attempts       = attempts + 1,
              error_category = $2,
              last_error     = $3,
              due_at         = CASE WHEN $2 = 'transient' THEN $5::timestamptz ELSE due_at END,
              status         = CASE
                                 WHEN $2 = 'permanent' THEN 'failed'
                                 WHEN attempts + 1 >= $6::int THEN 'abandoned'
                                 ELSE 'pending'
                               END,
              -- Cast explicitly. A CASE whose other arm is NULL gives the
              -- planner nothing to infer a parameter's type from, so it settles
              -- on text, and the column refuses that at run time rather than at
              -- compile time.
              completed_at   = CASE
                                 WHEN $2 = 'permanent' OR attempts + 1 >= $6::int
                                 THEN $4::timestamptz
                                 ELSE NULL
                               END
        WHERE delivery_id = ANY($1::uuid[]) AND status = 'pending'`,
      [
        [...deliveryIds],
        failure.category,
        failure.error,
        failure.at,
        failure.retryAt,
        failure.maximumAttempts,
      ],
    );
  }

  /**
   * How a channel delivers for one account.
   *
   * @param userId - Whose.
   * @param channel - Which channel.
   * @returns The stored setting, or undefined where nothing has been chosen.
   */
  async settingFor(
    userId: string,
    channel: string,
  ): Promise<NotificationDeliverySetting | undefined> {
    const row = await this.dataSource
      .getRepository(NotificationDeliverySetting)
      .findOne({ where: { userId, channel } });

    return row ?? undefined;
  }

  /**
   * How every channel delivers for one account.
   *
   * @param userId - Whose.
   * @returns What has been chosen. An absent channel means the defaults.
   */
  async settingsFor(userId: string): Promise<NotificationDeliverySetting[]> {
    return this.dataSource.getRepository(NotificationDeliverySetting).findBy({ userId });
  }

  /**
   * Change how channels deliver.
   *
   * @param tx - The caller's transaction.
   * @param userId - Whose.
   * @param settings - What they chose.
   * @param at - When.
   * @returns Nothing.
   * @throws {QueryFailedError} If a quiet window's ends meet, or an hour falls
   *   outside 0 to 23. Refused by the database as well as by the contract,
   *   because these reach the dispatcher long after the request that set them
   *   and a nonsensical window there means silence rather than a bad response.
   */
  async setSettings(
    tx: Transaction,
    userId: string,
    settings: readonly {
      channel: string;
      mode: string;
      digestHour: number;
      quietFrom: number | null;
      quietUntil: number | null;
    }[],
    at: Date,
  ): Promise<void> {
    for (const setting of settings) {
      await tx.query(
        `INSERT INTO notification_delivery_settings
           (user_id, channel, mode, digest_hour, quiet_from, quiet_until, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, channel) DO UPDATE
            SET mode        = EXCLUDED.mode,
                digest_hour = EXCLUDED.digest_hour,
                quiet_from  = EXCLUDED.quiet_from,
                quiet_until = EXCLUDED.quiet_until,
                updated_at  = EXCLUDED.updated_at`,
        [
          userId,
          setting.channel,
          setting.mode,
          setting.digestHour,
          setting.quietFrom,
          setting.quietUntil,
          at,
        ],
      );
    }
  }
}

/** A device row as the database returns it. */
interface StoredDeviceRow {
  readonly device_id: string;
  readonly platform: string;
  readonly label: string | null;
  readonly status: string;
  readonly registered_at: Date;
  readonly last_seen_at: Date;
}

/**
 * Shape a stored device as its owner may see it.
 *
 * @param row - The row as stored, which deliberately does not include the
 *   token: every statement above selects the columns it needs, and none of them
 *   selects that one.
 * @returns The view. This is the function every read path goes through, so the
 *   credential cannot escape by somebody forgetting to leave it out.
 */
function toDeviceView(row: StoredDeviceRow): DeviceView {
  return {
    deviceId: row.device_id,
    platform: row.platform,
    label: row.label,
    status: row.status,
    registeredAt: row.registered_at,
    lastSeenAt: row.last_seen_at,
  };
}
