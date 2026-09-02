import type {
  DeliveryChannel,
  DeliverySettings,
  Device,
  RegisterDeviceRequest,
  SetDeliverySettingsRequest,
} from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { withTransaction, type Transaction } from "../../lib/database/transaction.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { generateId } from "../../lib/ids/generate-id.js";
import type { UserRepository } from "../users/user.repository.js";
import type { DeviceView, NotificationDeliveryRepository } from "./notification.delivery.repository.js";
import type { NotificationDeliverySetting } from "./notification.model.js";
import { permits, urgencyOf, type NotificationCategory } from "./notification.policy.js";
import type { RecipientDirectory } from "./notification.recipients.js";
import type { NotificationRepository } from "./notification.repository.js";
import { dueAt, type DeliverySchedule } from "./notification.schedule.js";

/** The channels a notification can actually be carried on. */
const CHANNELS: DeliveryChannel[] = ["email", "push"];

/**
 * What a channel does for somebody who has never touched the settings.
 *
 * Immediate, no quiet hours, and a morning digest hour that only matters if
 * they ever ask for a digest. Chosen so that absence means "as things happen",
 * matching preferences, where absence means yes — a new account hears about its
 * failed upload without having configured anything.
 */
const DEFAULT_SCHEDULE: DeliverySchedule = {
  mode: "immediate",
  digestHour: 9,
  quiet: undefined,
};

/**
 * Getting a notification out of the building.
 *
 * Two halves that share a table and little else. One decides, when a
 * notification is created, which channels should carry it and when — the whole
 * of preferences, quiet hours, and digests, resolved once and written down as
 * an instant. The other is the small set of things a person can change: the
 * devices push may reach, and when each channel delivers.
 *
 * What is deliberately not here is the sending. That belongs to the dispatcher,
 * because sending must not be able to delay or fail the activity that caused
 * it: `architecture/notifications.md:840` requires that provider delivery never
 * block a reaction, a Moment, a moderation decision, or a session revocation.
 * A row in a table is the seam that guarantees it.
 */
export class NotificationDeliveryService {
  /**
   * Build the delivery service.
   *
   * @param dataSource - Opens the transactions device and setting changes
   *   commit in. Scheduling takes the caller's transaction instead, so a
   *   delivery and the notification it carries commit together.
   * @param deliveries - Where devices, deliveries, and settings are stored.
   * @param notifications - Consulted for whether a category is wanted on a
   *   channel.
   * @param accounts - Read for the time zone the schedule is computed in.
   * @param recipients - Asked whether there is anywhere to send an email.
   * @param now - Reads the clock, injected so scheduling can be tested.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly deliveries: NotificationDeliveryRepository,
    private readonly notifications: NotificationRepository,
    private readonly accounts: UserRepository,
    private readonly recipients: RecipientDirectory,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Open deliveries for a notification that has just been recorded.
   *
   * Runs inside the generator's transaction, so a notification and its
   * deliveries land together or not at all. The alternative — recording the
   * notification and then scheduling — is a dual write, and its failure mode is
   * a notification nobody is ever told about.
   *
   * @param tx - The caller's transaction.
   * @param entry - Which notification, for whom, in which category, and when
   *   the activity happened.
   * @returns The channels a delivery was opened on, so a caller can report it
   *   and a test can assert it. An empty list is ordinary: somebody with no
   *   verified address, no device, and everything switched off still has an
   *   in-app notification, which is the canonical one.
   */
  async schedule(
    tx: Transaction,
    entry: {
      notificationId: string;
      recipientUserId: string;
      category: NotificationCategory;
      at: Date;
    },
  ): Promise<DeliveryChannel[]> {
    const urgency = urgencyOf(entry.category);
    const timeZone = await this.timeZoneFor(entry.recipientUserId);
    const opened: DeliveryChannel[] = [];

    for (const channel of CHANNELS) {
      if (!(await this.wanted(entry.recipientUserId, entry.category, channel))) {
        continue;
      }

      if (!(await this.reachable(entry.recipientUserId, channel))) {
        continue;
      }

      const schedule = toSchedule(
        await this.deliveries.settingFor(entry.recipientUserId, channel),
      );

      // The mode is recorded as immediate for anything that may not wait, even
      // where the account has asked for a digest. This is the second of the two
      // places that keeps a required notification out of a summary — the first
      // being that its due time ignores the digest hour — and it is the one
      // that stops the dispatcher gathering it with its neighbours at send
      // time.
      const mode = urgency === "ordinary" ? schedule.mode : "immediate";

      const wasOpened = await this.deliveries.schedule(tx, {
        deliveryId: generateId(),
        notificationId: entry.notificationId,
        recipientUserId: entry.recipientUserId,
        channel,
        mode,
        dueAt: dueAt(entry.at, urgency, schedule, timeZone),
        at: entry.at,
      });

      if (wasOpened) {
        opened.push(channel);
      }
    }

    return opened;
  }

  /**
   * Register a device to receive push.
   *
   * @param userId - Whose.
   * @param request - The platform, the provider token, and an optional label.
   * @returns The device without its token. Registering the same token again
   *   refreshes the registration rather than opening a second one, so a client
   *   may call this on every launch; registering a token another account holds
   *   moves it, and that account stops receiving.
   */
  async registerDevice(userId: string, request: RegisterDeviceRequest): Promise<Device> {
    const at = this.now();

    const stored = await withTransaction(this.dataSource, (tx) =>
      this.deliveries.registerDevice(tx, {
        deviceId: generateId(),
        userId,
        platform: request.platform,
        token: request.token,
        label: request.label,
        at,
      }),
    );

    return toDevice(stored);
  }

  /**
   * Retire a device.
   *
   * What signing out on a device does. `architecture/notifications.md:927` asks
   * that the relationship between logout and push tokens be explicit, and the
   * explicit answer is that history stays and delivery stops: notifications
   * remain in the account, and nothing more arrives on that device.
   *
   * @param userId - Whose.
   * @param deviceId - Which one.
   * @returns Nothing. Retiring one already retired is success: the desired
   *   state holds.
   * @throws {NotFoundError} If there is no such device or it is not theirs.
   *   Somebody else's reads as absent rather than forbidden — that a device
   *   exists is a fact about an account the caller is not party to.
   */
  async removeDevice(userId: string, deviceId: string): Promise<void> {
    if ((await this.deliveries.findDevice(deviceId, userId)) === undefined) {
      throw new NotFoundError("No such device");
    }

    await withTransaction(this.dataSource, (tx) =>
      this.deliveries.invalidateDevice(tx, deviceId, userId, this.now()),
    );
  }

  /**
   * When each channel delivers.
   *
   * @param userId - Whose.
   * @returns Every channel, with what has been chosen or the defaults where
   *   nothing has.
   */
  async settings(userId: string): Promise<DeliverySettings> {
    const stored = new Map(
      (await this.deliveries.settingsFor(userId)).map((one) => [one.channel, one]),
    );

    return {
      settings: CHANNELS.map((channel) => {
        const setting = stored.get(channel);

        return {
          channel,
          mode: (setting?.mode ?? DEFAULT_SCHEDULE.mode) as "immediate" | "digest",
          digestHour: setting?.digestHour ?? DEFAULT_SCHEDULE.digestHour,
          quietFrom: setting?.quietFrom ?? null,
          quietUntil: setting?.quietUntil ?? null,
        };
      }),
    };
  }

  /**
   * Change when each channel delivers.
   *
   * @param userId - Whose.
   * @param request - What they chose.
   * @returns The settings as they now stand.
   */
  async setSettings(
    userId: string,
    request: SetDeliverySettingsRequest,
  ): Promise<DeliverySettings> {
    await withTransaction(this.dataSource, (tx) =>
      this.deliveries.setSettings(tx, userId, request.settings, this.now()),
    );

    return this.settings(userId);
  }

  /**
   * Whether somebody wants this category on this channel.
   *
   * @param userId - Whose preference.
   * @param category - The family.
   * @param channel - Where it would go.
   * @returns Whether to open a delivery. Always true for a required category:
   *   `architecture/notifications.md:749` allows security email past a
   *   preference that would otherwise silence it, and the reason is that
   *   turning that preference off is the first thing somebody taking over an
   *   account would do.
   */
  private async wanted(
    userId: string,
    category: NotificationCategory,
    channel: DeliveryChannel,
  ): Promise<boolean> {
    return permits(category, await this.notifications.preferenceFor(userId, category, channel));
  }

  /**
   * Whether there is anywhere for this channel to send.
   *
   * @param userId - Whose.
   * @param channel - Which channel.
   * @returns Whether a delivery is worth opening. A push delivery for somebody
   *   with no device would sit pending until it was abandoned, filling the
   *   retry ceiling with rows that never had anywhere to go.
   */
  private async reachable(userId: string, channel: DeliveryChannel): Promise<boolean> {
    return channel === "push"
      ? this.deliveries.hasActiveDevice(userId)
      : (await this.recipients.emailFor(userId)) !== undefined;
  }

  /**
   * The zone the schedule is computed in.
   *
   * @param userId - Whose.
   * @returns Their zone, or UTC where they have not set one. Null means "follow
   *   the device", which is a question this process cannot ask — so quiet hours
   *   for somebody who has never chosen a zone run against UTC, which is at
   *   least the same every day.
   */
  private async timeZoneFor(userId: string): Promise<string> {
    const account = await this.accounts.findAccount(userId);

    return account?.preferences.timeZone ?? "UTC";
  }
}

/**
 * Read a stored setting as a schedule, or the defaults where there is none.
 *
 * @param setting - What is stored for this channel, if anything.
 * @returns The schedule. A half-specified quiet window cannot arrive here — the
 *   database refuses one — so the pair is read together and a missing end means
 *   no quiet hours at all rather than a window running to midnight.
 */
function toSchedule(setting: NotificationDeliverySetting | undefined): DeliverySchedule {
  if (setting === undefined) {
    return DEFAULT_SCHEDULE;
  }

  return {
    mode: setting.mode === "digest" ? "digest" : "immediate",
    digestHour: setting.digestHour,
    quiet:
      setting.quietFrom === null || setting.quietUntil === null
        ? undefined
        : { from: setting.quietFrom, until: setting.quietUntil },
  };
}

/**
 * Shape a stored device for a caller.
 *
 * @param device - The device as read, already without its token.
 * @returns The contract shape.
 */
function toDevice(device: DeviceView): Device {
  return {
    deviceId: device.deviceId,
    platform: device.platform as Device["platform"],
    label: device.label,
    status: device.status as Device["status"],
    registeredAt: device.registeredAt.toISOString(),
    lastSeenAt: device.lastSeenAt.toISOString(),
  };
}
