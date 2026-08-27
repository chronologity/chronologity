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

  /** `social`, `media`, `moderation`, or `security`. Constrained by the database. */
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

  /** `in_app`, `email`, or `push`. */
  @PrimaryColumn("text")
  channel!: string;

  @Column("boolean")
  enabled!: boolean;

  @Column("timestamptz", { name: "updated_at" })
  updatedAt!: Date;
}

/**
 * A device push can reach.
 *
 * The token column is the only place in this system a provider credential
 * lives, which is deliberate: one place to erase, and no join path from
 * anything a client reads. Nothing that returns a device to a caller carries
 * it, because no outbound contract has a field it could occupy.
 */
@Entity("notification_devices")
@Index("notification_devices_active_idx", ["userId"], { where: "status = 'active'" })
export class NotificationDevice {
  @PrimaryColumn("uuid", { name: "device_id" })
  deviceId!: string;

  @Column("uuid", { name: "user_id" })
  userId!: string;

  /** `ios`, `android`, or `web`. Constrained by the database. */
  @Column("text")
  platform!: string;

  /**
   * The provider's credential for this installation.
   *
   * Never logged and never returned. Anybody holding it can send to that
   * device, which is what makes it a credential rather than an identifier.
   */
  @Column("text")
  token!: string;

  /** Cosmetic. Never used to decide where anything goes. */
  @Column("text", { nullable: true })
  label!: string | null;

  /** `active` or `invalidated`. Retired rather than deleted. */
  @Column("text")
  status!: string;

  @Column("timestamptz", { name: "registered_at" })
  registeredAt!: Date;

  /** Moved forward whenever the same token is registered again. */
  @Column("timestamptz", { name: "last_seen_at" })
  lastSeenAt!: Date;

  @Column("timestamptz", { name: "invalidated_at", nullable: true })
  invalidatedAt!: Date | null;
}

/**
 * One notification's journey down one channel.
 *
 * `dueAt` carries the whole of quiet hours and digests, resolved once when the
 * delivery is created. The dispatcher only ever asks whether that instant has
 * passed — it never reads a time zone, and so cannot get one wrong.
 */
@Entity("notification_deliveries")
export class NotificationDelivery {
  @PrimaryColumn("uuid", { name: "delivery_id" })
  deliveryId!: string;

  @Column("uuid", { name: "notification_id" })
  notificationId!: string;

  /** Denormalised so a digest can be gathered by recipient without a join. */
  @Column("uuid", { name: "recipient_user_id" })
  recipientUserId!: string;

  /** `email` or `push`. There is no `in_app`: the notification row is that. */
  @Column("text")
  channel!: string;

  /**
   * `immediate` or `digest`, decided when the delivery was created.
   *
   * Recorded rather than inferred at send time, so two immediate notifications
   * landing in the same second are not silently merged into a digest nobody
   * asked for.
   */
  @Column("text")
  mode!: string;

  /** `pending`, `sent`, `failed`, `abandoned`, or `cancelled`. */
  @Column("text")
  status!: string;

  @Column("timestamptz", { name: "due_at" })
  dueAt!: Date;

  @Column("int")
  attempts!: number;

  /** `transient` is retried; `permanent` is not. */
  @Column("text", { name: "error_category", nullable: true })
  errorCategory!: string | null;

  @Column("text", { name: "last_error", nullable: true })
  lastError!: string | null;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @Column("timestamptz", { name: "completed_at", nullable: true })
  completedAt!: Date | null;
}

/**
 * When a channel delivers, as opposed to whether it delivers at all.
 *
 * Two questions that look alike and are not. A preference says whether to tell
 * somebody; this says when, and can only ever delay. There is no time zone
 * column — it is read from `user_preferences`, because a time zone stored twice
 * is a time zone that will disagree with itself the first time somebody moves.
 */
@Entity("notification_delivery_settings")
export class NotificationDeliverySetting {
  @PrimaryColumn("uuid", { name: "user_id" })
  userId!: string;

  @PrimaryColumn("text")
  channel!: string;

  @Column("text")
  mode!: string;

  @Column("int", { name: "digest_hour" })
  digestHour!: number;

  /** Local hours. Both set or both null; the database refuses one alone. */
  @Column("int", { name: "quiet_from", nullable: true })
  quietFrom!: number | null;

  @Column("int", { name: "quiet_until", nullable: true })
  quietUntil!: number | null;

  @Column("timestamptz", { name: "updated_at" })
  updatedAt!: Date;
}
