import {
  addMediaRequestSchema,
  assertMomentRelationshipRequestSchema,
  commentPageSchema,
  commentSchema,
  correctOccurrenceRequestSchema,
  createCommentRequestSchema,
  createMomentRequestSchema,
  editCommentRequestSchema,
  identifierSchema,
  listCommentsRequestSchema,
  listMomentsRequestSchema,
  momentAudienceSchema,
  momentPageSchema,
  momentRelationshipListSchema,
  momentRelationshipSchema,
  momentSchema,
  personalSignificanceSchema,
  reactionSummarySchema,
  reorderMediaRequestSchema,
  setCommentPolicyRequestSchema,
  setLocationDisclosureRequestSchema,
  setMomentVisibilityRequestSchema,
  setReactionRequestSchema,
  setReactionsEnabledRequestSchema,
  updateCaptionRequestSchema,
} from "@chronologity/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../../plugins/auth.plugin.js";
import { errors } from "../../server/error-responses.js";
import type { MomentCommentService } from "./moment-comment.service.js";
import type { MomentReactionService } from "./moment-reaction.service.js";
import type { MomentSignificanceService } from "./moment-significance.service.js";
import type { MomentRelationshipService } from "./moment-relationship.service.js";
import type { MomentService } from "./moment.service.js";

/**
 * Moment endpoints.
 *
 * Reading and writing are separated by who is allowed to do them, not by URL.
 * Every change here is the author's alone; reads admit whoever the Moment is
 * visible to, and refuse everybody else as though it did not exist.
 *
 * Listing is bounded and continues by cursor rather than by offset, so a Moment
 * recorded while somebody is paging cannot cause another to be skipped or
 * repeated.
 *
 * @param moments - The service these routes delegate to.
 * @param relationships - Claims connecting Moments. Optional so an application
 *   can be built without them; the endpoints are absent rather than failing.
 * @param reactions - Responses to Moments. Optional so an application can be
 *   built without them; the endpoints are absent rather than failing.
 * @param comments - Discussion about Moments. Optional so an application can be
 *   built without it; the endpoints are absent rather than failing.
 * @param significance - Saying a Moment matters to you. Optional for the same
 *   reason.
 * @returns A Fastify plugin registering the Moment endpoints.
 */
export function momentRoutes(
  moments: MomentService,
  relationships?: MomentRelationshipService,
  reactions?: MomentReactionService,
  comments?: MomentCommentService,
  significance?: MomentSignificanceService,
) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    // Every route this module registers, grouped under one heading in the
    // published document. A hook rather than a line on each route: a route
    // added later is grouped without anybody remembering to say so.
    app.addHook("onRoute", (route) => {
      route.schema = { ...route.schema, tags: ["Moments"] };
    });

    app.post(
      "/moments",
      {
        schema: {
          summary: "Record a Moment",
          description:
            "Chronology comes from `occurrence`, never from when this was called: a Moment entered today for 2014 belongs in 2014. Occurrence is an interval at the precision it is actually known at, so a summer stays a summer rather than acquiring a fabricated day. Media is required and must already be `ready`.", body: createMomentRequestSchema, response: { 201: momentSchema, ...errors(400, 401, 403) } },
        preHandler: requireUser,
      },
      async (request, reply) => {
        const moment = await moments.record(request.user.userId, request.body, request.requestContext);

        return reply.status(201).send(moment);
      },
    );

    app.get(
      "/moments",
      {
        schema: {
          summary: "List your own Moments",
          description:
            "Everything you recorded, at every visibility, newest occurrence first. Paged by cursor; the cursor is opaque and taking it apart will break when the ordering changes.", querystring: listMomentsRequestSchema, response: { 200: momentPageSchema, ...errors(400, 401, 403) } },
        preHandler: requireUser,
      },
      async (request) =>
        moments.list(request.user.userId, request.query.limit, request.query.cursor),
    );

    app.patch(
      "/moments/:momentId",
      {
        schema: {
          summary: "Correct a caption",
          description:
            "Every change is kept, with what the thing was before.",
          params: z.object({ momentId: identifierSchema }),
          body: updateCaptionRequestSchema,
          response: { 200: momentSchema, ...errors(400, 401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.updateCaption(
          request.params.momentId,
          request.user.userId,
          request.body.caption,
          request.requestContext,
        ),
    );

    // Its own endpoint rather than part of the patch above, because correcting
    // when something happened is not the same act as fixing a typo: it moves
    // the Moment through chronology, and `moments.md:443` asks that the two not
    // be flattened into one.
    app.put(
      "/moments/:momentId/occurrence",
      {
        schema: {
          summary: "Correct when it happened",
          description:
            "Its own operation, separate from a caption: moving a Moment through chronology is a historical correction, and a caption is enrichment.",
          params: z.object({ momentId: identifierSchema }),
          body: correctOccurrenceRequestSchema,
          response: { 200: momentSchema, ...errors(400, 401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.correctOccurrence(
          request.params.momentId,
          request.user.userId,
          request.body.occurrence,
          request.body.occurrenceOffsetMinutes,
          request.requestContext,
        ),
    );

    app.post(
      "/moments/:momentId/media",
      {
        schema: {
          summary: "Add media",
          params: z.object({ momentId: identifierSchema }),
          body: addMediaRequestSchema,
          response: { 200: momentSchema, ...errors(400, 401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.addMedia(
          request.params.momentId,
          request.user.userId,
          request.body.uploadIds,
          request.requestContext,
        ),
    );

    app.put(
      "/moments/:momentId/media/order",
      {
        schema: {
          summary: "Reorder media",
          description:
            "Presentation only. It never moves the Moment through chronology.",
          params: z.object({ momentId: identifierSchema }),
          body: reorderMediaRequestSchema,
          response: { 200: momentSchema, ...errors(400, 401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.reorderMedia(
          request.params.momentId,
          request.user.userId,
          request.body.uploadIds,
          request.requestContext,
        ),
    );

    app.delete(
      "/moments/:momentId/media/:uploadId",
      {
        schema: {
          summary: "Remove one piece of media",
          description:
            "Removing the last one is refused: media is required, so it would leave a Moment that could not have been created. Deleting the Moment is a different operation.",
          params: z.object({ momentId: identifierSchema, uploadId: identifierSchema }),
          response: { 200: momentSchema, ...errors(400, 401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.removeMedium(
          request.params.momentId,
          request.user.userId,
          request.params.uploadId,
          request.requestContext,
        ),
    );

    app.delete(
      "/moments/:momentId",
      {
        schema: {
          summary: "Delete a Moment",
          params: z.object({ momentId: identifierSchema }),
          response: { 204: z.null(), ...errors(401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await moments.delete(request.params.momentId, request.user.userId, request.requestContext);

        return reply.status(204).send(null);
      },
    );

    // Association is its own surface rather than a general update, because
    // these are historical claims rather than fields. Saying where something
    // happened and correcting a caption are not the same kind of act, and
    // `moments.md:407` asks that the difference not be flattened.
    app.put(
      "/moments/:momentId/location",
      {
        schema: {
          summary: "Say where it happened",
          description:
            "Replaces whatever was said before. One place per Moment: media pointing at several distinct places usually means several Moments.",
          params: z.object({ momentId: identifierSchema }),
          body: z.object({ locationId: identifierSchema }),
          response: { 200: momentSchema, ...errors(400, 401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.setLocation(
          request.params.momentId,
          request.user.userId,
          request.body.locationId,
          request.requestContext,
        ),
    );

    app.delete(
      "/moments/:momentId/location",
      {
        schema: {
          summary: "Take the place back",
          description:
            "The Moment survives losing its place. Removing context is not removing history.",
          params: z.object({ momentId: identifierSchema }),
          response: { 200: momentSchema, ...errors(401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request) => moments.clearLocation(request.params.momentId, request.user.userId, request.requestContext),
    );

    app.post(
      "/moments/:momentId/real-world-events",
      {
        schema: {
          summary: "Associate a real-world Event",
          description:
            "Several are permitted, unlike places: a photograph at a wedding that is also part of a family reunion is genuinely both.",
          params: z.object({ momentId: identifierSchema }),
          body: z.object({ realWorldEventId: identifierSchema }),
          response: { 200: momentSchema, ...errors(400, 401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.addRealWorldEvent(
          request.params.momentId,
          request.user.userId,
          request.body.realWorldEventId,
          request.requestContext,
        ),
    );

    app.delete(
      "/moments/:momentId/real-world-events/:realWorldEventId",
      {
        schema: {
          summary: "Remove an Event association",
          params: z.object({
            momentId: identifierSchema,
            realWorldEventId: identifierSchema,
          }),
          response: { 200: momentSchema, ...errors(401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.removeRealWorldEvent(
          request.params.momentId,
          request.user.userId,
          request.params.realWorldEventId,
          request.requestContext,
        ),
    );

    app.get(
      "/moments/:momentId",
      {
        schema: {
          summary: "Read one Moment",
          description:
            "`place` reflects what you in particular may be told about where this happened: below `exact` it carries no identifier and no coordinates, so what was withheld cannot be looked up.",
          params: z.object({ momentId: identifierSchema }),
          response: { 200: momentSchema, ...errors(401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request) => moments.get(request.params.momentId, request.user.userId),
    );

    // Visibility and audience together, so a Moment is never briefly restricted
    // with a list left over from an earlier decision.
    app.put(
      "/moments/:momentId/visibility",
      {
        schema: {
          summary: "Set who may see it",
          description:
            "Visibility and audience together, so a Moment is never restricted with a list left from an earlier decision. An audience is accepted only with `restricted`. Changing visibility never moves the Moment through chronology.",
          params: z.object({ momentId: identifierSchema }),
          body: setMomentVisibilityRequestSchema,
          response: { 200: momentSchema, ...errors(400, 401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.setVisibility(
          request.params.momentId,
          request.user.userId,
          request.body,
          request.requestContext,
        ),
    );

    // Its own operation, and not folded into setting the place. Moving a Moment
    // to a different venue is not a decision to publish it.
    app.put(
      "/moments/:momentId/location/disclosure",
      {
        schema: {
          summary: "Set how much of the place others are told",
          description:
            "A different question from the Location's own `precision`, which says how well anybody knows where this happened. This says how much of that another Viewer receives. You always see the exact place yourself.",
          params: z.object({ momentId: identifierSchema }),
          body: setLocationDisclosureRequestSchema,
          response: { 200: momentSchema, ...errors(400, 401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.setLocationDisclosure(
          request.params.momentId,
          request.user.userId,
          request.body.disclosure,
          request.requestContext,
        ),
    );

    // The author's own. A list of the people somebody trusted with something is
    // itself something to be trusted with, so there is no direction of this
    // that a Viewer can read.
    app.get(
      "/moments/:momentId/audience",
      {
        schema: {
          summary: "Read who may see a restricted Moment",
          description:
            "The author's own list. Being on it does not entitle somebody to read it.",
          params: z.object({ momentId: identifierSchema }),
          response: { 200: momentAudienceSchema, ...errors(401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request) => moments.audience(request.params.momentId, request.user.userId),
    );

    if (relationships !== undefined) {
      // A claim, never a derivation. Chronologity knows only that one Moment
      // preceded another (`causality.md:103`), so nothing here is inferred from
      // order.
      app.post(
        "/moments/:momentId/relationships",
        {
          schema: {
          summary: "Claim a relationship to another Moment",
          description:
            "A claim somebody made, never something derived from chronological order: that one Moment preceded another says nothing about why. One of the two Moments must be your own. A causal claim contradicting the known times is refused, though an order nobody can establish is allowed.",
            params: z.object({ momentId: identifierSchema }),
            body: assertMomentRelationshipRequestSchema,
            response: { 201: momentRelationshipSchema, ...errors(400, 401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request, reply) => {
          const relationship = await relationships.assert(
            request.params.momentId,
            request.user.userId,
            request.body,
          );

          return reply.status(201).send(relationship);
        },
      );

      // Both directions. A relationship whose far end this Viewer cannot see is
      // absent entirely: the identifier alone would disclose that something is
      // there (`privacy.md:158`).
      app.get(
        "/moments/:momentId/relationships",
        {
          schema: {
          summary: "List relationships, in both directions",
          description:
            "A relationship whose other end you may not see is absent entirely rather than returned with the identifier blanked, because the identifier is itself the disclosure.",
            params: z.object({ momentId: identifierSchema }),
            response: { 200: momentRelationshipListSchema, ...errors(401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request) => relationships.list(request.params.momentId, request.user.userId),
      );

      // Only whoever made a claim may withdraw it. Withdrawing leaves both
      // Moments exactly as they were.
      app.delete(
        "/moments/:momentId/relationships/:relationshipId",
        {
          schema: {
          summary: "Withdraw a claim you made",
          description:
            "Only whoever made a claim may withdraw it: owning one end does not make somebody else's reading of history yours to retract. Both Moments are left exactly as they were.",
            params: z.object({
              momentId: identifierSchema,
              relationshipId: identifierSchema,
            }),
            response: { 204: z.null(), ...errors(401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request, reply) => {
          await relationships.withdraw(request.params.relationshipId, request.user.userId);

          return reply.status(204).send(null);
        },
      );
    }

    if (reactions !== undefined) {
      // Singular: at most one reaction per person per Moment, so setting a
      // second kind replaces the first rather than adding to it.
      app.put(
        "/moments/:momentId/reaction",
        {
          schema: {
            summary: "Leave or change your reaction",
            description:
              "Replaces whatever you left before; you hold at most one reaction per Moment, so the total counts you once. A Moment not accepting reactions and an author who has blocked you answer the same way, because naming a block would tell somebody they had been blocked.",
            params: z.object({ momentId: identifierSchema }),
            body: setReactionRequestSchema,
            response: { 200: reactionSummarySchema, ...errors(400, 401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request) =>
          reactions.react(request.params.momentId, request.user.userId, request.body.kind),
      );

      app.delete(
        "/moments/:momentId/reaction",
        {
          schema: {
            summary: "Take your reaction back",
            description:
              "Permitted even where reacting is not, so somebody blocked afterwards — or reacting before the author turned reactions off — can still withdraw. Withdrawing one you never left is the state you asked for, not an error.",
            params: z.object({ momentId: identifierSchema }),
            response: { 200: reactionSummarySchema, ...errors(401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request) => reactions.withdraw(request.params.momentId, request.user.userId),
      );

      // Counts, never identities. A list of who reacted to a restricted Moment
      // would reveal that Moment's audience to everybody on it
      // (`reactions.md:307`).
      app.get(
        "/moments/:momentId/reactions",
        {
          schema: {
            summary: "How a Moment has been responded to",
            description:
              "Counts by kind, the number of people, and your own. Never who else reacted. `enabled: false` means the author turned reactions off and the counts are withheld — which is a different fact from nobody having reacted, and worth rendering differently. Counts are derived and may lag; they are engagement, never historical importance.",
            params: z.object({ momentId: identifierSchema }),
            response: { 200: reactionSummarySchema, ...errors(401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request) => reactions.summary(request.params.momentId, request.user.userId),
      );

      app.put(
        "/moments/:momentId/reactions/enabled",
        {
          schema: {
            summary: "Turn reactions on or off",
            description:
              "Turning them off hides the existing counts as well as refusing new ones. Nothing is deleted: turning them back on brings the same counts back.",
            params: z.object({ momentId: identifierSchema }),
            body: setReactionsEnabledRequestSchema,
            response: { 200: reactionSummarySchema, ...errors(400, 401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request) =>
          reactions.setEnabled(request.params.momentId, request.user.userId, request.body),
      );
    }

    if (comments !== undefined) {
      app.post(
        "/moments/:momentId/comments",
        {
          schema: {
            summary: "Say something about a Moment",
            description:
              "Conversation, not history: when this was written says nothing about when the Moment happened, and nothing here moves it. Supply `commentId` to make a retry safe — the same identifier twice yields one comment, while the same text twice without one yields two, because repeating yourself deliberately is allowed. Replying to a reply joins that reply's thread rather than nesting deeper.",
            params: z.object({ momentId: identifierSchema }),
            body: createCommentRequestSchema,
            response: { 201: commentSchema, ...errors(400, 401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request, reply) => {
          const comment = await comments.add(
            request.params.momentId,
            request.user.userId,
            request.body,
          );

          return reply.status(201).send(comment);
        },
      );

      // Oldest first, unlike every other list here. Reading a conversation
      // newest-first privileges recency over the context that makes later
      // replies comprehensible (`comments.md:198`).
      app.get(
        "/moments/:momentId/comments",
        {
          schema: {
            summary: "Read a Moment's discussion",
            description:
              "Top-level comments, oldest first, and never ranked by engagement. `total` counts replies too. A deleted comment with replies appears as a tombstone carrying neither body nor author, so the replies still have something to hang from; one without replies is simply gone.",
            params: z.object({ momentId: identifierSchema }),
            querystring: listCommentsRequestSchema,
            response: { 200: commentPageSchema, ...errors(400, 401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request) =>
          comments.list(
            request.params.momentId,
            request.user.userId,
            request.query.limit,
            request.query.cursor,
          ),
      );

      app.get(
        "/comments/:commentId/replies",
        {
          schema: {
            summary: "Read one thread",
            description: "Replies to a top-level comment, oldest first.",
            params: z.object({ commentId: identifierSchema }),
            querystring: listCommentsRequestSchema,
            response: { 200: commentPageSchema, ...errors(400, 401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request) =>
          comments.replies(
            request.params.commentId,
            request.user.userId,
            request.query.limit,
            request.query.cursor,
          ),
      );

      app.patch(
        "/comments/:commentId",
        {
          schema: {
            summary: "Correct what you said",
            description:
              "Marks the comment edited and leaves its place in the conversation alone — editing must not become a way of moving up the discussion.",
            params: z.object({ commentId: identifierSchema }),
            body: editCommentRequestSchema,
            response: { 200: commentSchema, ...errors(400, 401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request) =>
          comments.edit(request.params.commentId, request.user.userId, request.body.body),
      );

      app.delete(
        "/comments/:commentId",
        {
          schema: {
            summary: "Take back what you said",
            description:
              "Leaves the Moment untouched. If replies hang from it, a tombstone remains so the conversation still reads; if none do, it disappears.",
            params: z.object({ commentId: identifierSchema }),
            response: { 204: z.null(), ...errors(401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request, reply) => {
          await comments.remove(request.params.commentId, request.user.userId);

          return reply.status(204).send(null);
        },
      );

      app.put(
        "/moments/:momentId/comments/policy",
        {
          schema: {
            summary: "Set who may join the discussion",
            description:
              "`anyone` who can see the Moment, `followers` of its author, or `disabled`. Closing a discussion refuses new comments and leaves what was already said readable — removing it would be a separate act. The author may always comment on their own Moment.",
            params: z.object({ momentId: identifierSchema }),
            body: setCommentPolicyRequestSchema,
            response: { 204: z.null(), ...errors(400, 401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request, reply) => {
          await comments.setPolicy(request.params.momentId, request.user.userId, request.body);

          return reply.status(204).send(null);
        },
      );

      app.put(
        "/comments/:commentId/reaction",
        {
          schema: {
            summary: "React to a comment",
            description:
              "The same four kinds a Moment takes. A Moment's own reaction setting does not reach its discussion: silencing reactions to a photograph should not silence agreement between people talking underneath it.",
            params: z.object({ commentId: identifierSchema }),
            body: setReactionRequestSchema,
            response: { 200: commentSchema, ...errors(400, 401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request) =>
          comments.react(request.params.commentId, request.user.userId, request.body.kind),
      );

      app.delete(
        "/comments/:commentId/reaction",
        {
          schema: {
            summary: "Take a reaction to a comment back",
            params: z.object({ commentId: identifierSchema }),
            response: { 200: commentSchema, ...errors(401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request) => comments.unreact(request.params.commentId, request.user.userId),
      );
    }

    if (significance !== undefined) {
      // The one significance signal a person supplies. Everything else is
      // derived from the shape of history and is not exposed: Chronologity does
      // not show a universal significance score.
      app.put(
        "/moments/:momentId/significance",
        {
          schema: {
            summary: "Say this Moment matters to you",
            description:
              "Private, always — nobody sees anybody else's mark, and no response anywhere carries one. You may mark any Moment you can see, including one somebody else recorded: the last photograph of a loved one may have been taken by a sibling. Two people marking the same Moment is not a conflict; each mark belongs to its own history. Marking twice is the state already holding.",
            params: z.object({ momentId: identifierSchema }),
            response: { 200: personalSignificanceSchema, ...errors(401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request) => significance.mark(request.params.momentId, request.user.userId),
      );

      app.delete(
        "/moments/:momentId/significance",
        {
          schema: {
            summary: "Take your mark back",
            description: "Unmarking one you never marked is the state you asked for, not an error.",
            params: z.object({ momentId: identifierSchema }),
            response: { 200: personalSignificanceSchema, ...errors(401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request) => significance.unmark(request.params.momentId, request.user.userId),
      );

      app.get(
        "/moments/:momentId/significance",
        {
          schema: {
            summary: "Whether you marked this Moment",
            description:
              "Your own mark and nothing else. Which Moments matter to somebody is closer to a diary than to a reaction, so there is no way to ask whether anybody else marked one.",
            params: z.object({ momentId: identifierSchema }),
            response: { 200: personalSignificanceSchema, ...errors(401, 403, 404) },
          },
          preHandler: requireUser,
        },
        async (request) => significance.read(request.params.momentId, request.user.userId),
      );
    }

    // Somebody else's history, filtered to what this Viewer may see. Asking for
    // your own returns everything, exactly as `GET /moments` does.
    app.get(
      "/users/:userId/moments",
      {
        schema: {
          summary: "Read somebody's history",
          description:
            "Only the Moments you may see. Pages are full rather than thinned after the fact, so a short page means the end rather than that something was removed. Asking for your own returns everything.",
          params: z.object({ userId: identifierSchema }),
          querystring: listMomentsRequestSchema,
          response: { 200: momentPageSchema, ...errors(400, 401, 403, 404) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.listForViewer(
          request.params.userId,
          request.user.userId,
          request.query.limit,
          request.query.cursor,
        ),
    );
  };
}
