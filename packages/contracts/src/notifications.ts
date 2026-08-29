import { z } from "zod";
import { identifierSchema } from "./identifiers.js";
import { timestampSchema } from "./time.js";

/**
 * Notification boundary contracts.
 *
 * A notification travels further than the thing it describes — into a list
 * somebody scrolls without thinking, and later onto a lock screen. So what
 * crosses this boundary is deliberately thin: what happened, what it happened
 * to, and who did it, with the wording composed from what the reader may see at
 * the moment they read it rather than from anything stored when it was made.
 *
 * `notifications.md:238` lists what a notification can disclose even when the
 * underlying resource is protected. Nothing here carries a caption, a comment,
 * or a thumbnail, because nothing behind it stores one.
 */

/** What happened. */
export const notificationTypeSchema = z.enum([
  "moment_reacted",
  "comment_reacted",
  "moment_commented",
  "comment_replied",
  "comment_mentioned",
  "user_followed",
  "follow_requested",
  "follow_request_accepted",
  "participation_proposed",
  "participation_accepted",
  "participation_rejected",
  "participation_withdrawn",
  "upload_ready",
  "upload_rejected",
  "content_moderated",
  "password_set",
  "password_changed",
  "phone_claimed",
  "phone_removed",
  "email_verified",
  "sessions_revoked",
]);

export type NotificationType = z.infer<typeof notificationTypeSchema>;

/**
 * Which family it belongs to.
 *
 * Categories exist so notifications are not one undifferentiated stream
 * (`notifications.md:104`): they carry different preference controls, and one
 * of them cannot be switched off.
 */
export const notificationCategorySchema = z.enum([
  "social",
  "media",
  "moderation",
  "security",
  /**
   * Being named in somebody else's history.
   *
   * Its own family rather than social, because a person may reasonably silence
   * reactions and follows while still needing to hear that somebody has claimed
   * they were somewhere. Answering such a claim is the consent model working,
   * and a category switched off alongside likes would make the one notification
   * that model depends on the easiest to lose.
   */
  "participation",
]);

export type NotificationCategory = z.infer<typeof notificationCategorySchema>;

/** Where a notification can be delivered. */
export const notificationChannelSchema = z.enum(["in_app", "email", "push"]);

export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

/** What a notification points at. */
export const notificationSourceTypeSchema = z.enum([
  "moment",
  "comment",
  "user",
  "upload",
  /**
   * A participation, rather than the Moment it concerns.
   *
   * Deliberately not the Moment: visibility is re-checked at read time for
   * anything sourced from one, and the person being asked to confirm they were
   * somewhere frequently cannot read it — so such a notification would be
   * written and then never render for the one person who has to see it.
   */
  "participation",
]);

export type NotificationSourceType = z.infer<typeof notificationSourceTypeSchema>;

/**
 * Somebody who contributed to a notification.
 *
 * Present only for actors the reader is entitled to know about. Where they are
 * not, the person is counted in `others` and never named — an aggregated
 * notification must not become a way to learn who somebody is.
 */
export const notificationActorSchema = z.object({
  userId: identifierSchema,
  handle: z.string(),
  displayName: z.string(),
});

export type NotificationActor = z.infer<typeof notificationActorSchema>;

/** One thing that happened. */
export const notificationSchema = z.object({
  notificationId: identifierSchema,
  type: notificationTypeSchema,
  category: notificationCategorySchema,
  /**
   * Where to go, and what to reauthorize on arrival.
   *
   * A deep link is a pointer and never a permission: opening one resolves
   * access again, so a notification about something since made private refuses
   * to open rather than opening it.
   */
  source: z.object({
    type: notificationSourceTypeSchema,
    id: identifierSchema,
  }),
  /** Who did it, where the reader may know. At most two, however many acted. */
  actors: z.array(notificationActorSchema),
  /** How many more acted than are named. */
  otherActors: z.number().int().min(0),
  createdAt: timestampSchema,
  readAt: timestampSchema.nullable(),
});

export type Notification = z.infer<typeof notificationSchema>;

/** A page of notifications. */
export const notificationPageSchema = z.object({
  notifications: z.array(notificationSchema),
  nextCursor: z.string().optional(),
});

export type NotificationPage = z.infer<typeof notificationPageSchema>;

/**
 * How many are waiting.
 *
 * Counted over what the reader can currently see, so a notification about
 * something since made inaccessible leaves the count as well as the list. A
 * count that outran the list would be a way to learn that something existed.
 */
export const unreadCountSchema = z.object({
  unread: z.number().int().min(0),
});

export type UnreadCount = z.infer<typeof unreadCountSchema>;

/** What a caller may ask for when listing. */
export const listNotificationsRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
  /** Only what has not been read. */
  unreadOnly: z.coerce.boolean().default(false),
});

export type ListNotificationsRequest = z.infer<typeof listNotificationsRequestSchema>;

/** One preference. */
export const notificationPreferenceSchema = z.object({
  category: notificationCategorySchema,
  channel: notificationChannelSchema,
  enabled: z.boolean(),
});

export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

/**
 * Somebody's preferences, and which of them are fixed.
 *
 * `required` names the categories that are delivered whatever the preference
 * says. It is returned rather than left for a client to know, so an interface
 * can show the control as fixed instead of accepting a change that will not
 * take effect.
 */
export const notificationPreferencesSchema = z.object({
  preferences: z.array(notificationPreferenceSchema),
  required: z.array(notificationCategorySchema),
});

export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

/** Changing what you hear about. */
export const setNotificationPreferencesRequestSchema = z.object({
  preferences: z.array(notificationPreferenceSchema).min(1).max(20),
});

export type SetNotificationPreferencesRequest = z.infer<
  typeof setNotificationPreferencesRequestSchema
>;

/**
 * Where a notification can actually be carried.
 *
 * `in_app` is absent because there is nothing to carry: the notification row is
 * the in-app notification, and it exists whether or not any provider is
 * reachable (`architecture/notifications.md:727`).
 */
export const deliveryChannelSchema = z.enum(["email", "push"]);

export type DeliveryChannel = z.infer<typeof deliveryChannelSchema>;

/** What kind of device a push would go to. */
export const devicePlatformSchema = z.enum(["ios", "android", "web"]);

export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

/**
 * Registering a device to receive push.
 *
 * The token is a provider credential rather than an identifier: anybody holding
 * it can send to that device. It crosses this boundary inwards only, and no
 * response schema in this file carries it back out.
 */
export const registerDeviceRequestSchema = z.object({
  platform: devicePlatformSchema,
  /**
   * The provider's token for this installation.
   *
   * Bounded because provider tokens are bounded — APNs is 64 hexadecimal
   * characters, FCM a few hundred — and an unbounded string reaching a database
   * column is how a text field becomes a storage endpoint.
   */
  token: z.string().min(1).max(4096),
  /**
   * What to call it in a list of devices, where the client has something to
   * call it. Never used for delivery.
   */
  label: z.string().min(1).max(120).optional(),
});

export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequestSchema>;

/**
 * A registered device, as its owner may see it.
 *
 * Deliberately without the token. `architecture/notifications.md:857` requires
 * device tokens to stay out of client-readable profile data, and the way to
 * guarantee that is for no outbound schema to have a field they could occupy.
 */
export const deviceSchema = z.object({
  deviceId: identifierSchema,
  platform: devicePlatformSchema,
  label: z.string().nullable(),
  /** `active` until a logout or a provider rejection retires it. */
  status: z.enum(["active", "invalidated"]),
  registeredAt: timestampSchema,
  lastSeenAt: timestampSchema,
});

export type Device = z.infer<typeof deviceSchema>;

/**
 * When a channel delivers, rather than what it delivers.
 *
 * Separate from preferences because the questions are different: a preference
 * says whether to tell somebody at all, and this says when. Per channel and not
 * per category — push is for what is worth interrupting and email for a
 * summary, and those want opposite answers, while a matrix over both would be
 * the settings screen `architecture/notifications.md:690` asks to avoid.
 */
export const deliverySettingSchema = z
  .object({
    channel: deliveryChannelSchema,
    /** `immediate` sends as things happen; `digest` gathers them into one. */
    mode: z.enum(["immediate", "digest"]),
    /** Local hour the digest goes out, in the account's own time zone. */
    digestHour: z.number().int().min(0).max(23),
    /**
     * The hours nothing ordinary is delivered in, as local hours.
     *
     * Null for no quiet hours at all. The opening hour is quiet and the closing
     * hour is not, so `22` to `7` is quiet from 22:00 until 06:59.
     */
    quietFrom: z.number().int().min(0).max(23).nullable(),
    quietUntil: z.number().int().min(0).max(23).nullable(),
  })
  .refine(
    (value) => (value.quietFrom === null) === (value.quietUntil === null),
    { message: "Give both ends of the quiet window, or neither" },
  )
  .refine((value) => value.quietFrom === null || value.quietFrom !== value.quietUntil, {
    // A window whose ends meet has no honest reading: zero hours or every hour,
    // and either answer would be one somebody did not ask for. Two nulls are
    // not a window whose ends meet — they are no window at all, which is what
    // most accounts have and must stay expressible.
    message: "A quiet window must begin and end at different hours",
  });

export type DeliverySetting = z.infer<typeof deliverySettingSchema>;

/** How each channel delivers. */
export const deliverySettingsSchema = z.object({
  settings: z.array(deliverySettingSchema),
});

export type DeliverySettings = z.infer<typeof deliverySettingsSchema>;

/**
 * Changing when a channel delivers.
 *
 * Note what this cannot do: no setting here suppresses a delivery, only delays
 * it. Quiet hours and digests "affect delivery time only"
 * (`product/notifications.md:533`), so a required notification still arrives —
 * it simply arrives when the window ends rather than never.
 */
export const setDeliverySettingsRequestSchema = z.object({
  settings: z.array(deliverySettingSchema).min(1).max(2),
});

export type SetDeliverySettingsRequest = z.infer<typeof setDeliverySettingsRequestSchema>;
