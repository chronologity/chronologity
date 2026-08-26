import type { DataSource } from "typeorm";
import type { Cursor } from "../../lib/pagination/cursor.js";
import type { Transaction } from "../../lib/database/transaction.js";
import {
  Notification,
  NotificationActor,
  NotificationPreference,
} from "./notification.model.js";

/** A notification with everybody who contributed to it. */
export interface NotificationWithActors {
  readonly notification: Notification;
  /** Most recent first. */
  readonly actorUserIds: string[];
}

/** Reads and writes notifications. */
export class NotificationRepository {
  /**
   * Build the notification repository.
   *
   * @param dataSource - Used for reads. Writes take a transaction, so a
   *   notification and the actor that caused it commit together.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Record that something happened, collapsing into an unread entry if one
   * stands.
   *
   * The whole of aggregation and deduplication, in one statement each, and
   * neither depends on the caller remembering anything. The first insert
   * collapses on the partial unique index over unread rows; the second is
   * refused by the primary key when the same message is delivered twice.
   *
   * @param tx - The caller's transaction.
   * @param entry - The notification to open or add to.
   * @returns Whether this actually recorded something. False means the same
   *   message had already been handled for this person, which is the ordinary
   *   consequence of at-least-once delivery rather than a failure.
   */
  async record(
    tx: Transaction,
    entry: {
      notificationId: string;
      recipientUserId: string;
      type: string;
      category: string;
      sourceType: string;
      sourceId: string;
      aggregationKey: string;
      viaMomentId: string | undefined;
      /** Absent for a notification nobody is named on, such as a moderation decision. */
      actorUserId: string | undefined;
      sourceEventId: string;
      at: Date;
    },
  ): Promise<boolean> {
    // Deduplication first, and on its own row. The same message redelivered
    // gets no further than here, whether or not the notification it produced
    // has since been read — which is what a key on the actor could not have
    // managed, since reading an entry frees the aggregation key.
    const first: { source_event_id: string }[] = await tx.query(
      `INSERT INTO notification_source_events (source_event_id, recipient_user_id, handled_at)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING source_event_id`,
      [entry.sourceEventId, entry.recipientUserId, entry.at],
    );

    if (first.length === 0) {
      return false;
    }

    // Reuse the unread entry if there is one, and open a new one otherwise.
    // `DO NOTHING` rather than `DO UPDATE`: an aggregated notification keeps
    // the time it was opened, so a page does not reshuffle under somebody
    // every time another person reacts.
    const opened: { notification_id: string }[] = await tx.query(
      `INSERT INTO notifications (notification_id, recipient_user_id, type, category,
                                  source_type, source_id, via_moment_id, aggregation_key,
                                  created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (aggregation_key) WHERE read_at IS NULL AND dismissed_at IS NULL
         DO NOTHING
       RETURNING notification_id`,
      [
        entry.notificationId,
        entry.recipientUserId,
        entry.type,
        entry.category,
        entry.sourceType,
        entry.sourceId,
        entry.viaMomentId ?? null,
        entry.aggregationKey,
        entry.at,
      ],
    );

    const standing: { notification_id: string }[] =
      opened.length > 0
        ? opened
        : await tx.query(
            `SELECT notification_id FROM notifications
              WHERE aggregation_key = $1 AND read_at IS NULL AND dismissed_at IS NULL`,
            [entry.aggregationKey],
          );

    const notificationId = standing[0]?.notification_id;

    if (notificationId === undefined) {
      // The entry was read between the insert and the lookup. Nothing to add
      // to; the next message about this will open a fresh one.
      return false;
    }

    if (entry.actorUserId !== undefined) {
      await tx.query(
        `INSERT INTO notification_actors (notification_id, actor_user_id, acted_at)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [notificationId, entry.actorUserId, entry.at],
      );
    }

    return true;
  }

  /**
   * Somebody's notifications, newest first.
   *
   * @param recipientUserId - Whose.
   * @param unreadOnly - Whether to leave out what has been read.
   * @param limit - How many at most.
   * @param cursor - Where to continue from, or undefined for the first page.
   * @returns The page, each with its actors. Dismissed entries are never
   *   returned: dismissing is how somebody says they are finished with
   *   something, which is different from having read it.
   */
  async list(
    recipientUserId: string,
    unreadOnly: boolean,
    limit: number,
    cursor?: Cursor,
  ): Promise<NotificationWithActors[]> {
    const query = this.dataSource
      .getRepository(Notification)
      .createQueryBuilder("notification")
      .where("notification.recipient_user_id = :recipientUserId", { recipientUserId })
      .andWhere("notification.dismissed_at IS NULL");

    if (unreadOnly) {
      query.andWhere("notification.read_at IS NULL");
    }

    if (cursor !== undefined) {
      query.andWhere(
        "(notification.created_at, notification.notification_id) < (:cursorAt, :cursorId)",
        { cursorAt: cursor.at, cursorId: cursor.id },
      );
    }

    const notifications = await query
      .orderBy("notification.created_at", "DESC")
      .addOrderBy("notification.notification_id", "DESC")
      .take(limit)
      .getMany();

    return this.withActors(notifications);
  }

  /**
   * Attach the actors to a page of notifications.
   *
   * One query for the page rather than one per row, so a page costs two reads
   * however long it is.
   *
   * @param notifications - The page.
   * @returns Each with its actors, most recent first.
   */
  private async withActors(
    notifications: readonly Notification[],
  ): Promise<NotificationWithActors[]> {
    if (notifications.length === 0) {
      return [];
    }

    const actors = await this.dataSource
      .getRepository(NotificationActor)
      .createQueryBuilder("actor")
      .where("actor.notification_id IN (:...ids)", {
        ids: notifications.map((one) => one.notificationId),
      })
      .orderBy("actor.acted_at", "DESC")
      .getMany();

    const byNotification = new Map<string, string[]>();

    for (const actor of actors) {
      const existing = byNotification.get(actor.notificationId) ?? [];

      existing.push(actor.actorUserId);
      byNotification.set(actor.notificationId, existing);
    }

    return notifications.map((notification) => ({
      notification,
      actorUserIds: byNotification.get(notification.notificationId) ?? [],
    }));
  }

  /**
   * One notification, for opening it.
   *
   * @param notificationId - Which one.
   * @param recipientUserId - Who is asking.
   * @returns It with its actors, or undefined when there is no such
   *   notification or it is not theirs. Somebody else's is reported as absent
   *   rather than forbidden: that a notification exists is itself a disclosure
   *   about activity they are not party to.
   */
  async find(
    notificationId: string,
    recipientUserId: string,
  ): Promise<NotificationWithActors | undefined> {
    const notification = await this.dataSource
      .getRepository(Notification)
      .findOne({ where: { notificationId, recipientUserId } });

    if (notification === null) {
      return undefined;
    }

    return (await this.withActors([notification]))[0];
  }

  /**
   * Every unread notification, so the count can be taken over what is visible.
   *
   * The count is not `SELECT COUNT(*)`, deliberately. A notification about
   * something the reader can no longer see must leave the count as well as the
   * list, and only the caller knows what they can see — a count that outran the
   * list would itself say that something existed.
   *
   * @param recipientUserId - Whose.
   * @param limit - A ceiling, so the count is bounded work. A number past it is
   *   reported as the ceiling rather than counted exactly, which is what any
   *   interface showing a badge does anyway.
   * @returns The unread entries, newest first.
   */
  async unread(recipientUserId: string, limit: number): Promise<NotificationWithActors[]> {
    return this.list(recipientUserId, true, limit);
  }

  /**
   * Mark one as read.
   *
   * @param tx - The caller's transaction.
   * @param notificationId - Which one.
   * @param recipientUserId - Who is asking, so nobody reads somebody else's.
   * @param at - When.
   * @returns Whether it changed. False when it was already read, which is
   *   success: the desired state holds.
   */
  async markRead(
    tx: Transaction,
    notificationId: string,
    recipientUserId: string,
    at: Date,
  ): Promise<boolean> {
    const rows: { count: number }[] = await tx.query(
      `WITH marked AS (
          UPDATE notifications SET read_at = $3
           WHERE notification_id = $1 AND recipient_user_id = $2 AND read_at IS NULL
       RETURNING 1
       ) SELECT COUNT(*)::int AS count FROM marked`,
      [notificationId, recipientUserId, at],
    );

    return (rows[0]?.count ?? 0) > 0;
  }

  /**
   * Mark everything read.
   *
   * @param tx - The caller's transaction.
   * @param recipientUserId - Whose.
   * @param at - When.
   * @returns How many changed.
   */
  async markAllRead(tx: Transaction, recipientUserId: string, at: Date): Promise<number> {
    const rows: { count: number }[] = await tx.query(
      `WITH marked AS (
          UPDATE notifications SET read_at = $2
           WHERE recipient_user_id = $1 AND read_at IS NULL
       RETURNING 1
       ) SELECT COUNT(*)::int AS count FROM marked`,
      [recipientUserId, at],
    );

    return rows[0]?.count ?? 0;
  }

  /**
   * Put one away.
   *
   * @param tx - The caller's transaction.
   * @param notificationId - Which one.
   * @param recipientUserId - Who is asking.
   * @param at - When.
   * @returns Whether it changed.
   */
  async dismiss(
    tx: Transaction,
    notificationId: string,
    recipientUserId: string,
    at: Date,
  ): Promise<boolean> {
    const rows: { count: number }[] = await tx.query(
      `WITH put_away AS (
          UPDATE notifications SET dismissed_at = $3, read_at = COALESCE(read_at, $3)
           WHERE notification_id = $1 AND recipient_user_id = $2 AND dismissed_at IS NULL
       RETURNING 1
       ) SELECT COUNT(*)::int AS count FROM put_away`,
      [notificationId, recipientUserId, at],
    );

    return (rows[0]?.count ?? 0) > 0;
  }

  /**
   * What somebody has chosen to hear about.
   *
   * @param userId - Whose.
   * @returns Their preferences. An absent one means yes.
   */
  async preferencesFor(userId: string): Promise<NotificationPreference[]> {
    return this.dataSource.getRepository(NotificationPreference).findBy({ userId });
  }

  /**
   * Whether one category on one channel is wanted.
   *
   * @param userId - Whose.
   * @param category - The family.
   * @param channel - Where it would go.
   * @returns What they chose, or undefined where they have chosen nothing.
   */
  async preferenceFor(
    userId: string,
    category: string,
    channel: string,
  ): Promise<boolean | undefined> {
    const stored = await this.dataSource
      .getRepository(NotificationPreference)
      .findOne({ where: { userId, category, channel } });

    return stored?.enabled;
  }

  /**
   * Set what somebody hears about.
   *
   * @param tx - The caller's transaction.
   * @param userId - Whose.
   * @param preferences - What they chose.
   * @param at - When.
   * @returns Nothing.
   */
  async setPreferences(
    tx: Transaction,
    userId: string,
    preferences: readonly { category: string; channel: string; enabled: boolean }[],
    at: Date,
  ): Promise<void> {
    for (const preference of preferences) {
      await tx
        .createQueryBuilder()
        .insert()
        .into(NotificationPreference)
        .values({ userId, ...preference, updatedAt: at })
        .orUpdate(["enabled", "updated_at"], ["user_id", "category", "channel"])
        .execute();
    }
  }
}
