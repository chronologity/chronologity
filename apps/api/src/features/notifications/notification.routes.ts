import {
  identifierSchema,
  listNotificationsRequestSchema,
  notificationPageSchema,
  notificationPreferencesSchema,
  notificationSchema,
  setNotificationPreferencesRequestSchema,
  unreadCountSchema,
} from "@chronologity/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../../plugins/auth.plugin.js";
import { errors } from "../../server/error-responses.js";
import type { NotificationService } from "./notification.service.js";

const notificationParams = z.object({ notificationId: identifierSchema });

/**
 * Notification endpoints.
 *
 * Everything here is about the caller's own notifications; there is no path by
 * which anybody reads anybody else's. What is worth knowing about these is not
 * the shapes but what they deliberately never contain — a caption, a comment,
 * or a thumbnail — because nothing behind them stores one.
 *
 * @param notifications - The service these routes delegate to.
 * @returns A Fastify plugin registering the notification endpoints.
 */
export function notificationRoutes(notifications: NotificationService) {
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
          description:
            "Every category on every channel. `required` names the categories delivered whatever you choose — currently moderation, because being told what was done to your content is what makes appealing it possible. Only the in-app channel delivers anything yet.",
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
  };
}
