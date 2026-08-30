import {
  createSavedViewRequestSchema,
  createShareRequestSchema,
  identifierSchema,
  renameSavedViewRequestSchema,
  savedViewListSchema,
  savedViewSchema,
  savedViewShareListSchema,
  savedViewShareSchema,
  sharedViewSchema,
} from "@chronologity/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../../plugins/auth.plugin.js";
import { errors } from "../../server/error-responses.js";
import type { SavedViewService } from "./saved-view.service.js";

/**
 * Saved Views.
 *
 * A Saved View keeps a **perspective on history** rather than a list of
 * Moments: whose history, over what stretch of time, seen which way. Reopening
 * it derives history as it stands now, so a view saved last year shows what has
 * been added since while still meaning what it meant.
 *
 * **Keeping a view grants nothing, and sharing one grants nothing.** Every
 * opening is authorised for whoever is doing the opening.
 *
 * @param savedViews - The service these routes delegate to.
 * @returns A Fastify plugin registering the Saved View endpoints.
 */
export function savedViewRoutes(savedViews: SavedViewService) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.addHook("onRoute", (route) => {
      route.schema = { ...route.schema, tags: ["Saved Views"] };
    });

    const viewParams = z.object({ savedViewId: identifierSchema });
    const shareParams = z.object({ shareId: identifierSchema });

    app.post(
      "/saved-views",
      {
        schema: {
          summary: "Keep the view you are looking at",
          description: [
            "Stores what you are looking at — the context, the lens, the stretch of time, where you had got to — under a name you choose.",
            "",
            "**What is kept is the view, not the Moments.** Reopening it next year derives history as it stands then, so a view of a place shows what has been added to it since, and a view of \"this year\" means whichever year you open it in.",
            "",
            "Keeping a view grants you nothing. It is authorised afresh each time it is opened, so a Moment that is public today and private tomorrow simply stops appearing.",
          ].join("\n"),
          body: createSavedViewRequestSchema,
          response: { 201: savedViewSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request, reply) =>
        reply.status(201).send(await savedViews.save(request.user.userId, request.body)),
    );

    app.get(
      "/saved-views",
      {
        schema: {
          summary: "Your saved views",
          description:
            "Newest first. Each carries its specification, so a client can show what a view is about — a place, a decade, a lens — without deriving it.",
          querystring: z.object({
            limit: z.coerce.number().int().min(1).max(100).default(50),
            cursor: z.string().max(200).optional(),
          }),
          response: { 200: savedViewListSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        savedViews.list(request.user.userId, {
          limit: request.query.limit,
          cursor: request.query.cursor,
        }),
    );

    app.get(
      "/saved-views/:savedViewId",
      {
        schema: {
          summary: "One of your saved views",
          description:
            "The view and what it is about. Somebody else's reads as absent rather than refused, so identifiers cannot be probed.",
          params: viewParams,
          response: { 200: savedViewSchema, ...errors(400, 401, 404) },
        },
        preHandler: requireUser,
      },
      async (request) => savedViews.get(request.params.savedViewId, request.user.userId),
    );

    app.patch(
      "/saved-views/:savedViewId",
      {
        schema: {
          summary: "Rename a saved view",
          description: [
            "Changes what it is called and nothing else.",
            "",
            "**What it points at cannot be edited.** A view that pointed somewhere new would be a different view wearing an old name, and anybody holding a link to it would be given something they were never shown. Save another one instead.",
          ].join("\n"),
          params: viewParams,
          body: renameSavedViewRequestSchema,
          response: { 200: savedViewSchema, ...errors(400, 401, 404) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        savedViews.rename(request.params.savedViewId, request.user.userId, request.body.title),
    );

    app.delete(
      "/saved-views/:savedViewId",
      {
        schema: {
          summary: "Forget a saved view",
          description:
            "Removes it, and every link you made to it. A link to a view that no longer exists stops opening.",
          params: viewParams,
          response: { 204: z.null(), ...errors(400, 401, 404) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await savedViews.remove(request.params.savedViewId, request.user.userId);

        return reply.status(204).send(null);
      },
    );

    app.post(
      "/saved-views/:savedViewId/shares",
      {
        schema: {
          summary: "Make a link to a saved view",
          description: [
            "Creates a link somebody else can open. They see the view — the place, the range, the lens — derived **for them**.",
            "",
            "**Sharing confers no access.** Two people opening one link see different Moments, each seeing only what they were already entitled to, and neither learns what the other saw. A view full of your private history shows a stranger nothing at all.",
            "",
            "**You choose what the link says about you.** By default it names neither the title nor you: a title is your words about your own history, and a link outlives the conversation you sent it in. One view can be shared twice on different terms.",
            "",
            "The token is returned once here and readable afterwards from your own list of shares.",
          ].join("\n"),
          params: viewParams,
          body: createShareRequestSchema,
          response: { 201: savedViewShareSchema, ...errors(400, 401, 404) },
        },
        preHandler: requireUser,
      },
      async (request, reply) =>
        reply
          .status(201)
          .send(
            await savedViews.share(request.params.savedViewId, request.user.userId, request.body),
          ),
    );

    app.get(
      "/saved-views/:savedViewId/shares",
      {
        schema: {
          summary: "Links you have made to a saved view",
          description:
            "Including ones you have withdrawn, so you can see what you gave out and what you took back.",
          params: viewParams,
          response: { 200: savedViewShareListSchema, ...errors(400, 401, 404) },
        },
        preHandler: requireUser,
      },
      async (request) => savedViews.shares(request.params.savedViewId, request.user.userId),
    );

    app.delete(
      "/shares/:shareId",
      {
        schema: {
          summary: "Withdraw a link",
          description:
            "The link stops opening. Anybody still holding it is told there is no such shared view, which is what a token that never existed is told — a withdrawn link should not confirm to a guesser that it once worked.",
          params: shareParams,
          response: { 204: z.null(), ...errors(400, 401, 404) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await savedViews.revoke(request.params.shareId, request.user.userId);

        return reply.status(204).send(null);
      },
    );

    app.get(
      "/shared-views/:token",
      {
        schema: {
          summary: "Open a link somebody sent you",
          description: [
            "Returns the view: a context, a stretch of time, a lens. Not any history — you then read it through the Timeline as yourself, which is what stops a shared link ever showing you a Moment you could not otherwise open.",
            "",
            "Whether it names the view or the person who saved it is their choice, and by default it names neither.",
          ].join("\n"),
          params: z.object({ token: z.string().min(1).max(200) }),
          response: { 200: sharedViewSchema, ...errors(400, 401, 404) },
        },
        // Signed in, though the token is what authorises. A link is a
        // capability rather than a public address, and requiring a session
        // means an anonymous crawler cannot walk the token space.
        preHandler: requireUser,
      },
      async (request) => savedViews.open(request.params.token),
    );
  };
}
