import { Column, Entity, Index, PrimaryColumn } from "typeorm";

/**
 * The notification tables.
 *
 * Note what is absent. There is no column for a name, a caption, a comment, or
 * a thumbnail, and that is the design rather than an omission: the wording is
 * composed at read time from what the reader may currently see, so a privacy
 * change needs no propagation here and there is nothing stored for a later
 * erasure to miss.
 *
 * These describe tables the migrations own (ADR-099). The DataSource runs with
 * `synchronize` off, so nothing here alters a column.
 */

/** Something that happened, that somebody should hear about. */
@Entity("notifications")
@Index("notifications_recipient_idx", ["recipientUserId", "createdAt"])
export class Notification {
  @PrimaryColumn("uuid", { name: "notification_id" })
  notificationId!: string;

  @Column("uuid", { name: "recipient_user_id" })
  recipientUserId!: string;

  /** The stable part, and the part that is not sensitive. */
  @Column("text")
  type!: string;

  /** `social`, `media`, or `moderation`. Constrained by the database. */
  @Column("text")
  category!: string;

  @Column("text", { name: "source_type" })
  sourceType!: string;

  /** What to reauthorize when somebody opens it. Never proof of access. */
  @Column("uuid", { name: "source_id" })
  sourceId!: string;

  /**
   * The Moment whose visibility decides whether this may still be shown.
   *
   * A notification's source is not always what governs access to it: a mention
   * points at a comment, and what decides whether that comment may be seen is
   * the Moment it sits under. Null where nothing governs it.
   */
  @Column("uuid", { name: "via_moment_id", nullable: true })
  viaMomentId!: string | null;

  /**
   * What collapses together.
   *
   * Unread activity of one kind about one thing is one entry, enforced by a
   * partial unique index rather than by the generator remembering — two
   * messages about one Moment can be handled at the same instant by two
   * instances of a consumer group.
   */
  @Column("text", { name: "aggregation_key" })
  aggregationKey!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @Column("timestamptz", { name: "read_at", nullable: true })
  readAt!: Date | null;

  @Column("timestamptz", { name: "dismissed_at", nullable: true })
  dismissedAt!: Date | null;
}

/**
 * Somebody who contributed to a notification.
 *
 * Separate from the notification so "three people reacted" can name them at
 * read time to a reader entitled to know who they are, and count them to one
 * who is not. A rendered string would have to choose between those when it was
 * written, before anybody knew who would be reading.
 */
@Entity("notification_actors")
@Index("notification_actors_by_notification_idx", ["notificationId", "actedAt"])
export class NotificationActor {
  @PrimaryColumn("uuid", { name: "notification_id" })
  notificationId!: string;

  @PrimaryColumn("uuid", { name: "actor_user_id" })
  actorUserId!: string;

  @Column("timestamptz", { name: "acted_at" })
  actedAt!: Date;
}

/**
 * A message already turned into notifications.
 *
 * Deduplication lives here rather than on the actor row, because a moderation
 * notification has no actor: it tells somebody what was done to their content
 * and deliberately never says which moderator did it. Hanging deduplication off
 * an actor would have meant inventing one for those, or leaving them
 * undeduplicated.
 */
@Entity("notification_source_events")
export class NotificationSourceEvent {
  @PrimaryColumn("uuid", { name: "source_event_id" })
  sourceEventId!: string;

  /** One message can legitimately notify several people, each independently. */
  @PrimaryColumn("uuid", { name: "recipient_user_id" })
  recipientUserId!: string;

  @Column("timestamptz", { name: "handled_at" })
  handledAt!: Date;
}

/**
 * What somebody wants to hear about, and how.
 *
 * Absence means yes. Somebody who has never opened the settings has not asked
 * for silence, and an opt-in default would mean a new account is told nothing
 * at all — including that its upload failed.
 */
@Entity("notification_preferences")
export class NotificationPreference {
  @PrimaryColumn("uuid", { name: "user_id" })
  userId!: string;

  @PrimaryColumn("text")
  category!: string;

  /** `in_app`, `email`, or `push`. Only the first is delivered yet. */
  @PrimaryColumn("text")
  channel!: string;

  @Column("boolean")
  enabled!: boolean;

  @Column("timestamptz", { name: "updated_at" })
  updatedAt!: Date;
}
