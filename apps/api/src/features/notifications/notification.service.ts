import type {
  ListNotificationsRequest,
  Notification as NotificationContract,
  NotificationActor,
  NotificationCategory,
  NotificationPage,
  NotificationPreferences,
  SetNotificationPreferencesRequest,
  UnreadCount,
} from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { decodeCursor, encodeCursor } from "../../lib/pagination/cursor.js";
import { withTransaction } from "../../lib/database/transaction.js";
import type { MomentService } from "../moments/moment.service.js";
import type { FollowRepository } from "../social/follow.repository.js";
import type { UserRepository } from "../users/user.repository.js";
import { describeActors, isRequired } from "./notification.policy.js";
import type { NotificationRepository, NotificationWithActors } from "./notification.repository.js";

/** How many unread entries are counted before the count is reported as "many". */
const UNREAD_CEILING = 100;

/** The categories a preference screen can show. */
const CATEGORIES: NotificationCategory[] = ["social", "media", "moderation"];

/**
 * Reading what happened.
 *
 * Every notification is composed here, at read time, from what the reader may
 * currently see — which is the whole reason nothing is stored but identifiers.
 * Two properties fall out of that and neither needs any propagation:
 *
 * A notification about something the reader can no longer see does not render,
 * so it is absent from the list and from the count rather than blanked. And an
 * actor the reader may not know about is counted rather than named, so an
 * aggregated notification never becomes a way to learn who somebody is.
 */
export class NotificationService {
  /**
   * Build the notification service.
   *
   * @param dataSource - Opens the transactions read state commits in.
   * @param notifications - Where notifications are stored.
   * @param moments - Used to resolve whether the reader may still see what a
   *   notification is about. The Moment visibility rule, reused rather than
   *   restated.
   * @param users - Used to name actors the reader may know about.
   * @param follows - Used to ask whether a Block separates the reader from an
   *   actor, which decides both whether they are named and whether a
   *   notification about them renders at all.
   * @param now - Reads the clock, injected so read state can be tested.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationRepository,
    private readonly moments: MomentService,
    private readonly users: UserRepository,
    private readonly follows: FollowRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * What has happened, newest first.
   *
   * @param request - How many, where to continue from, and whether to leave out
   *   what has been read.
   * @param recipientUserId - Whose notifications.
   * @returns The page. Entries whose source the reader can no longer see are
   *   absent, so a page may be shorter than asked for — which is honest rather
   *   than a shortage.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async list(
    request: ListNotificationsRequest,
    recipientUserId: string,
  ): Promise<NotificationPage> {
    const stored = await this.notifications.list(
      recipientUserId,
      request.unreadOnly,
      request.limit,
      decodeCursor(request.cursor),
    );

    const rendered = await this.render(stored, recipientUserId);
    const last = stored.length === request.limit ? stored[stored.length - 1] : undefined;

    return {
      notifications: rendered,
      ...(last === undefined
        ? {}
        : {
            nextCursor: encodeCursor(
              last.notification.createdAt,
              last.notification.notificationId,
            ),
          }),
    };
  }

  /**
   * How many are waiting.
   *
   * Counted over what the reader can currently see rather than with `COUNT(*)`.
   * A count that outran the list would say that something existed which the
   * list had already decided not to show — which is the disclosure the whole
   * composition model exists to avoid.
   *
   * @param recipientUserId - Whose.
   * @returns The count, bounded. Past the ceiling it reports the ceiling, which
   *   is what an interface showing a badge does anyway.
   */
  async unreadCount(recipientUserId: string): Promise<UnreadCount> {
    const stored = await this.notifications.unread(recipientUserId, UNREAD_CEILING);
    const visible = await this.render(stored, recipientUserId);

    return { unread: visible.length };
  }

  /**
   * One notification, for opening it.
   *
   * @param notificationId - Which one.
   * @param recipientUserId - Who is asking.
   * @returns It, rendered.
   * @throws {NotFoundError} If there is no such notification, it is not theirs,
   *   or its source is no longer something they may see. A deep link is a
   *   pointer and never a permission: opening one resolves access again, so a
   *   notification about something since made private refuses rather than
   *   opening it.
   */
  async open(notificationId: string, recipientUserId: string): Promise<NotificationContract> {
    const stored = await this.notifications.find(notificationId, recipientUserId);

    if (stored === undefined) {
      throw new NotFoundError("No such notification");
    }

    const rendered = await this.render([stored], recipientUserId);
    const one = rendered[0];

    if (one === undefined) {
      throw new NotFoundError("No such notification");
    }

    return one;
  }

  /**
   * Mark one as read.
   *
   * @param notificationId - Which one.
   * @param recipientUserId - Who is asking.
   * @returns Nothing. Marking something already read is success: the desired
   *   state holds.
   * @throws {NotFoundError} If there is no such notification or it is not
   *   theirs.
   */
  async markRead(notificationId: string, recipientUserId: string): Promise<void> {
    if ((await this.notifications.find(notificationId, recipientUserId)) === undefined) {
      throw new NotFoundError("No such notification");
    }

    await withTransaction(this.dataSource, (tx) =>
      this.notifications.markRead(tx, notificationId, recipientUserId, this.now()),
    );
  }

  /**
   * Mark everything read.
   *
   * @param recipientUserId - Whose.
   * @returns Nothing.
   */
  async markAllRead(recipientUserId: string): Promise<void> {
    await withTransaction(this.dataSource, (tx) =>
      this.notifications.markAllRead(tx, recipientUserId, this.now()),
    );
  }

  /**
   * Put one away.
   *
   * Dismissing marks it read as well. Somebody who has put something away has
   * finished with it, and leaving it counted would be a badge nobody can clear.
   *
   * @param notificationId - Which one.
   * @param recipientUserId - Who is asking.
   * @returns Nothing.
   * @throws {NotFoundError} If there is no such notification or it is not
   *   theirs.
   */
  async dismiss(notificationId: string, recipientUserId: string): Promise<void> {
    if ((await this.notifications.find(notificationId, recipientUserId)) === undefined) {
      throw new NotFoundError("No such notification");
    }

    await withTransaction(this.dataSource, (tx) =>
      this.notifications.dismiss(tx, notificationId, recipientUserId, this.now()),
    );
  }

  /**
   * What somebody has chosen to hear about.
   *
   * @param userId - Whose.
   * @returns Every category on every channel, with what is fixed named
   *   separately so an interface can show a control as fixed rather than
   *   accepting a change that will not take effect.
   */
  async preferences(userId: string): Promise<NotificationPreferences> {
    const stored = await this.notifications.preferencesFor(userId);
    const chosen = new Map(
      stored.map((one) => [`${one.category}:${one.channel}`, one.enabled]),
    );

    return {
      preferences: CATEGORIES.flatMap((category) =>
        (["in_app", "email", "push"] as const).map((channel) => ({
          category,
          channel,
          // Absence means yes: somebody who has never opened the settings has
          // not asked for silence.
          enabled: chosen.get(`${category}:${channel}`) ?? true,
        })),
      ),
      required: CATEGORIES.filter(isRequired),
    };
  }

  /**
   * Change what somebody hears about.
   *
   * A change to a required category is stored and has no effect, rather than
   * being refused. Refusing would mean an interface has to know which
   * categories are fixed before it can send anything; storing it means the
   * preference is remembered if the category ever stops being required.
   *
   * @param userId - Whose.
   * @param request - What they chose.
   * @returns Their preferences as they now stand.
   */
  async setPreferences(
    userId: string,
    request: SetNotificationPreferencesRequest,
  ): Promise<NotificationPreferences> {
    await withTransaction(this.dataSource, (tx) =>
      this.notifications.setPreferences(tx, userId, request.preferences, this.now()),
    );

    return this.preferences(userId);
  }

  /**
   * Turn stored notifications into something a person reads.
   *
   * Where the privacy of this feature actually lives. Each entry is dropped
   * unless the reader may still see what it is about, and each actor is named
   * only if the reader may know who they are.
   *
   * @param stored - The notifications and their actors.
   * @param recipientUserId - Who is reading.
   * @returns The ones that render, in the order they were given.
   */
  private async render(
    stored: readonly NotificationWithActors[],
    recipientUserId: string,
  ): Promise<NotificationContract[]> {
    const rendered: NotificationContract[] = [];

    for (const entry of stored) {
      if (!(await this.stillVisible(entry, recipientUserId))) {
        continue;
      }

      const actors = await this.nameActors(entry.actorUserIds, recipientUserId);
      const described = describeActors(
        actors.map((actor) => actor.userId),
        entry.actorUserIds.length,
      );

      rendered.push({
        notificationId: entry.notification.notificationId,
        type: entry.notification.type as NotificationContract["type"],
        category: entry.notification.category as NotificationCategory,
        source: {
          type: entry.notification.sourceType as NotificationContract["source"]["type"],
          id: entry.notification.sourceId,
        },
        actors: actors.filter((actor) => described.named.includes(actor.userId)),
        otherActors: described.others,
        createdAt: entry.notification.createdAt.toISOString(),
        readAt: entry.notification.readAt?.toISOString() ?? null,
      });
    }

    return rendered;
  }

  /**
   * Whether the reader may still see what a notification is about.
   *
   * @param entry - The notification.
   * @param recipientUserId - Who is reading.
   * @returns Whether to render it. A Moment is checked through the Moment
   *   service, so the visibility rule is the one rule rather than a second
   *   opinion. The other source types are about the reader themselves — their
   *   own upload, their own content, somebody following them — and stay visible
   *   to them for as long as they exist.
   */
  private async stillVisible(
    entry: NotificationWithActors,
    recipientUserId: string,
  ): Promise<boolean> {
    // The Moment that governs access, which is not always the source. A mention
    // points at a comment; what decides whether that comment may be seen is the
    // Moment it sits under. Checking the source alone let a mention outlive its
    // Moment becoming private.
    const governing =
      entry.notification.viaMomentId ??
      (entry.notification.sourceType === "moment" ? entry.notification.sourceId : null);

    if (governing !== null) {
      try {
        await this.moments.get(governing, recipientUserId);

        return true;
      } catch {
        // Every refusal is reported as absence, which is exactly what should
        // happen here: the notification goes with it.
        return false;
      }
    }

    if (entry.notification.sourceType === "user") {
      // A notification whose whole content is a person — somebody followed you
      // — has nothing left to say once a Block separates you from them.
      return !(await this.blocked(entry.notification.sourceId, recipientUserId));
    }

    // The rest are about the reader themselves: their own upload, their own
    // content moderated. Those stay visible to them for as long as they exist.
    return true;
  }

  /**
   * Whether a Block separates two people, in either direction.
   *
   * @param oneUserId - One of them.
   * @param otherUserId - The other.
   * @returns Whether either has blocked the other. Both directions, for the
   *   reason every other read here uses both: an asymmetric rule leaves the
   *   blocker still being told about somebody they wanted nothing to do with.
   */
  private async blocked(oneUserId: string, otherUserId: string): Promise<boolean> {
    if (oneUserId === otherUserId) {
      return false;
    }

    const blocks = await this.follows.blocksBetween(oneUserId, otherUserId);

    return blocks.iBlockedThem || blocks.theyBlockedMe;
  }

  /**
   * Name the actors the reader may know about.
   *
   * @param actorUserIds - Everybody who contributed, most recent first.
   * @param recipientUserId - Who is reading.
   * @returns Those they may know about, at most two. Somebody suspended or
   *   deactivated is absent because `findPublic` refuses them, which is the
   *   same rule a profile follows; somebody a Block separates them from is
   *   absent because it is asked here. Either way they are counted rather than
   *   named.
   */
  private async nameActors(
    actorUserIds: readonly string[],
    recipientUserId: string,
  ): Promise<NotificationActor[]> {
    const named: NotificationActor[] = [];

    // Walks the whole list rather than the first two. Taking two and then
    // filtering would let a suspended or blocked actor occupy a slot and leave
    // "three people reacted" naming nobody when it could have named somebody.
    for (const actorUserId of actorUserIds) {
      if (named.length >= 2) {
        break;
      }

      if (actorUserId === recipientUserId || (await this.blocked(actorUserId, recipientUserId))) {
        continue;
      }

      const actor = await this.users.findPublic(actorUserId);

      if (actor !== undefined) {
        named.push({
          userId: actor.userId,
          handle: actor.handle,
          displayName: actor.displayName,
        });
      }
    }

    return named;
  }
}
