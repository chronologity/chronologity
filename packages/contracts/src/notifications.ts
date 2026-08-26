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
  "upload_ready",
  "upload_rejected",
  "content_moderated",
]);

export type NotificationType = z.infer<typeof notificationTypeSchema>;

/**
 * Which family it belongs to.
 *
 * Categories exist so notifications are not one undifferentiated stream
 * (`notifications.md:104`): they carry different preference controls, and one
 * of them cannot be switched off.
 */
export const notificationCategorySchema = z.enum(["social", "media", "moderation"]);

export type NotificationCategory = z.infer<typeof notificationCategorySchema>;

/** Where a notification can be delivered. */
export const notificationChannelSchema = z.enum(["in_app", "email", "push"]);

export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

/** What a notification points at. */
export const notificationSourceTypeSchema = z.enum(["moment", "comment", "user", "upload"]);

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
