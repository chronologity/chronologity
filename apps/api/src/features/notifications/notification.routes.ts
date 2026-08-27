import {
  deliverySettingsSchema,
  deviceSchema,
  identifierSchema,
  listNotificationsRequestSchema,
  notificationPageSchema,
  notificationPreferencesSchema,
  notificationSchema,
  registerDeviceRequestSchema,
  setDeliverySettingsRequestSchema,
  setNotificationPreferencesRequestSchema,
  unreadCountSchema,
} from "@chronologity/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../../plugins/auth.plugin.js";
import { errors } from "../../server/error-responses.js";
import type { NotificationDeliveryService } from "./notification.delivery.service.js";
import type { NotificationService } from "./notification.service.js";

const notificationParams = z.object({ notificationId: identifierSchema });
const deviceParams = z.object({ deviceId: identifierSchema });

/**
 * Notification endpoints.
 *
 * Everything here is about the caller's own notifications; there is no path by
 * which anybody reads anybody else's. What is worth knowing about these is not
 * the shapes but what they deliberately never contain — a caption, a comment,
 * or a thumbnail — because nothing behind them stores one.
 *
 * @param notifications - The service these routes delegate to.
 * @param delivery - Devices and delivery timing. Optional: a deployment with no
 *   way to send anything still serves the in-app notifications above, which are
 *   the canonical ones.
 * @returns A Fastify plugin registering the notification endpoints.
 */
export function notificationRoutes(
  notifications: NotificationService,
  delivery?: NotificationDeliveryService,
) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.addHook("onRoute", (route) => {
      route.schema = { ...route.schema, tags: ["Notifications"] };
    });

    app.get(
      "/notifications",
      {
        schema: {
          summary: "What has happened",
          description: [
            "Your notifications, newest first.",
            "",
            "**Each is composed when you read it, from what you may see now.** Nothing is stored but identifiers, so a notification about something you can no longer see is simply absent rather than blanked — and a privacy change needs no propagation to reach it.",
            "",
            "**Activity of one kind on one thing collapses while unread.** Three people reacting to a Moment is one entry, not three. Reading it starts a fresh one.",
            "",
            "People are named only where you may know who they are; anybody else is counted instead. An aggregated notification is never a way to learn who somebody is.",
            "",
            "A page may come back shorter than asked for, because entries you can no longer see were dropped. That is honest rather than a shortage.",
          ].join("\n"),
          querystring: listNotificationsRequestSchema,
          response: { 200: notificationPageSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) => notifications.list(request.query, request.user.userId),
    );

    app.get(
      "/notifications/unread-count",
      {
        schema: {
          summary: "How many are waiting",
          description:
            "Counted over what you can currently see, not over what exists. A count that outran the list would tell you something existed that the list had already decided not to show you. Bounded: past a hundred it reports a hundred.",
          response: { 200: unreadCountSchema, ...errors(401) },
        },
        preHandler: requireUser,
      },
      async (request) => notifications.unreadCount(request.user.userId),
    );

    app.get(
      "/notifications/:notificationId",
      {
        schema: {
          summary: "Open one",
          description:
            "**A notification is a pointer, never a permission.** Opening one resolves access again, so a notification about something since made private refuses to open rather than opening it. Somebody else's notification reads as absent rather than forbidden — that one exists is itself a disclosure about activity you are not party to.",
          params: notificationParams,
          response: { 200: notificationSchema, ...errors(401, 404) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        notifications.open(request.params.notificationId, request.user.userId),
    );

    app.put(
      "/notifications/:notificationId/read",
      {
        schema: {
          summary: "Mark one read",
          description:
            "Marking something already read succeeds: the state you asked for is the state that holds. Reading an aggregated entry also closes it, so later activity on the same thing opens a new one rather than growing this.",
          params: notificationParams,
          response: { 204: z.null(), ...errors(401, 404) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await notifications.markRead(request.params.notificationId, request.user.userId);

        return reply.status(204).send(null);
      },
    );

    app.put(
      "/notifications/read",
      {
        schema: {
          summary: "Mark everything read",
          response: { 204: z.null(), ...errors(401) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await notifications.markAllRead(request.user.userId);

        return reply.status(204).send(null);
      },
    );

    app.put(
      "/notifications/:notificationId/dismissed",
      {
        schema: {
          summary: "Put one away",
          description:
            "Dismissing marks it read as well. Somebody who has put something away has finished with it, and leaving it counted would be a badge nobody can clear.",
          params: notificationParams,
          response: { 204: z.null(), ...errors(401, 404) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await notifications.dismiss(request.params.notificationId, request.user.userId);

        return reply.status(204).send(null);
      },
    );

    app.get(
      "/notifications/preferences",
      {
        schema: {
          summary: "What you hear about",
          description: [
            "Every category on every channel.",
            "",
            "`required` names the categories delivered whatever you choose — moderation, because being told what was done to your content is what makes appealing it possible, and security, because a preference that could silence \"your password was changed\" would be the first thing somebody taking over your account turned off.",
            "",
            "**Switching a category off in-app silences its email and push too.** The in-app entry is the notification; the other channels carry it, and there is nothing to carry once it does not exist. The reverse does not hold: switching off email or push leaves the in-app entry standing.",
          ].join("\n"),
          response: { 200: notificationPreferencesSchema, ...errors(401) },
        },
        preHandler: requireUser,
      },
      async (request) => notifications.preferences(request.user.userId),
    );

    app.put(
      "/notifications/preferences",
      {
        schema: {
          summary: "Change what you hear about",
          description:
            "A change to a required category is remembered and has no effect, rather than being refused — so an interface need not know which categories are fixed before sending, and the preference is honoured if the category ever stops being required. **A preference can never cause a notification you were not entitled to receive**: eligibility is decided before preferences are consulted.",
          body: setNotificationPreferencesRequestSchema,
          response: { 200: notificationPreferencesSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) => notifications.setPreferences(request.user.userId, request.body),
    );

    if (delivery === undefined) {
      return;
    }

    app.post(
      "/notifications/devices",
      {
        schema: {
          summary: "Register a device for push",
          description: [
            "Registers this installation so push can reach it.",
            "",
            "**The token is a credential, not an identifier.** Anybody holding it can send to the device, so it goes in and never comes back out: no response here or anywhere else carries it, and it is never written to a log.",
            "",
            "Safe to call on every launch — the same token refreshes the existing registration rather than opening a second one. Registering a token another account currently holds moves it, and that account stops receiving: a phone can be handed on, and two people's private notifications must not arrive on one lock screen.",
          ].join("\n"),
          body: registerDeviceRequestSchema,
          response: { 201: deviceSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        const device = await delivery.registerDevice(request.user.userId, request.body);

        return reply.status(201).send(device);
      },
    );

    app.delete(
      "/notifications/devices/:deviceId",
      {
        schema: {
          summary: "Stop sending to a device",
          description:
            "What signing out on a device should do. Notification history stays in the account and nothing further arrives on that device. Somebody else's device reads as absent rather than forbidden — that one exists is a fact about an account you are not party to.",
          params: deviceParams,
          response: { 204: z.null(), ...errors(401, 404) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await delivery.removeDevice(request.user.userId, request.params.deviceId);

        return reply.status(204).send(null);
      },
    );

    app.get(
      "/notifications/delivery-settings",
      {
        schema: {
          summary: "When each channel delivers",
          description:
            "Separate from preferences, which say whether you hear about something at all. **These can only ever delay, never suppress**: a notification you cannot switch off still arrives when your quiet hours end rather than never. Hours are local to the time zone on your account.",
          response: { 200: deliverySettingsSchema, ...errors(401) },
        },
        preHandler: requireUser,
      },
      async (request) => delivery.settings(request.user.userId),
    );

    app.put(
      "/notifications/delivery-settings",
      {
        schema: {
          summary: "Change when each channel delivers",
          description: [
            "Per channel, because push and email want opposite answers: one is for what is worth interrupting you, the other for a summary.",
            "",
            "A quiet window may run past midnight — `22` to `7` is quiet from 22:00 until 06:59. The opening hour is quiet and the closing hour is not, and the two ends must differ.",
            "",
            "Account security ignores quiet hours entirely. By morning a stolen account may be gone, so that is the one thing worth waking you for; a moderation decision waits, because appealing it is no more possible at three than at eight.",
          ].join("\n"),
          body: setDeliverySettingsRequestSchema,
          response: { 200: deliverySettingsSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) => delivery.setSettings(request.user.userId, request.body),
    );
  };
}
