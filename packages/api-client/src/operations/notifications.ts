import {
  deliverySettingsSchema,
  deviceSchema,
  listNotificationsRequestSchema,
  notificationPageSchema,
  notificationPreferencesSchema,
  notificationSchema,
  unreadCountSchema,
  registerDeviceRequestSchema,
  setDeliverySettingsRequestSchema,
  setNotificationPreferencesRequestSchema,
} from "@chronologity/contracts";
import { z } from "zod";
import { defineOperation } from "./operation.js";

/**
 * Telling somebody something happened.
 *
 * **A notification is not an authorisation.** Its existence says something
 * occurred; it does not say the thing is still reachable. Opening what it points
 * at reauthorises against current state, and may find nothing — a client must
 * handle that as ordinary rather than as an error, because the alternative is
 * treating an old notification as proof of access (ADR-035).
 *
 * Read and dismissed are different: read means seen, dismissed means put away.
 */

/** Notifications for this account. */
export const listNotifications = defineOperation({
  method: "GET",
  template: "/notifications",
  query: listNotificationsRequestSchema,
  response: notificationPageSchema,
});

/** How many are unread, for a badge. */
export const getUnreadCount = defineOperation({
  method: "GET",
  template: "/notifications/unread-count",
  response: unreadCountSchema,
});

/** One notification. */
export const getNotification = defineOperation({
  method: "GET",
  template: "/notifications/:notificationId",
  path: (args: { params: { notificationId: string } }) =>
    `/notifications/${args.params.notificationId}`,
  response: notificationSchema,
});

/** Mark one as seen. */
export const markNotificationRead = defineOperation({
  method: "PUT",
  template: "/notifications/:notificationId/read",
  path: (args: { params: { notificationId: string } }) =>
    `/notifications/${args.params.notificationId}/read`,
  response: z.null(),
});

/** Mark everything as seen. */
export const markAllNotificationsRead = defineOperation({
  method: "PUT",
  template: "/notifications/read",
  response: z.null(),
});

/** Put one away. */
export const dismissNotification = defineOperation({
  method: "PUT",
  template: "/notifications/:notificationId/dismissed",
  path: (args: { params: { notificationId: string } }) =>
    `/notifications/${args.params.notificationId}/dismissed`,
  response: z.null(),
});

/** What this account wants to hear about. */
export const getNotificationPreferences = defineOperation({
  method: "GET",
  template: "/notifications/preferences",
  response: notificationPreferencesSchema,
});

/** Change what it wants to hear about. */
export const setNotificationPreferences = defineOperation({
  method: "PUT",
  template: "/notifications/preferences",
  body: setNotificationPreferencesRequestSchema,
  response: notificationPreferencesSchema,
});

/** Register a device for push. */
export const registerDevice = defineOperation({
  method: "POST",
  template: "/notifications/devices",
  body: registerDeviceRequestSchema,
  response: deviceSchema,
});

/** Retire a device. */
export const removeDevice = defineOperation({
  method: "DELETE",
  template: "/notifications/devices/:deviceId",
  path: (args: { params: { deviceId: string } }) =>
    `/notifications/devices/${args.params.deviceId}`,
  response: z.null(),
});

/** Which channels deliver which categories. */
export const getDeliverySettings = defineOperation({
  method: "GET",
  template: "/notifications/delivery-settings",
  response: deliverySettingsSchema,
});

/** Change which channels deliver which categories. */
export const setDeliverySettings = defineOperation({
  method: "PUT",
  template: "/notifications/delivery-settings",
  body: setDeliverySettingsRequestSchema,
  response: deliverySettingsSchema,
});
