import {
  addMediaRequestSchema,
  assertMomentRelationshipRequestSchema,
  correctOccurrenceRequestSchema,
  createMomentRequestSchema,
  identifierSchema,
  listMomentsRequestSchema,
  momentAudienceSchema,
  momentPageSchema,
  momentRelationshipListSchema,
  momentRelationshipSchema,
  momentSchema,
  reorderMediaRequestSchema,
  setLocationDisclosureRequestSchema,
  setMomentVisibilityRequestSchema,
  updateCaptionRequestSchema,
} from "@chronologity/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../../plugins/auth.plugin.js";
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
 * @returns A Fastify plugin registering the Moment endpoints.
 */
export function momentRoutes(moments: MomentService, relationships?: MomentRelationshipService) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.post(
      "/moments",
      {
        schema: { body: createMomentRequestSchema, response: { 201: momentSchema } },
        preHandler: requireUser,
      },
      async (request, reply) => {
        const moment = await moments.record(request.user.userId, request.body);

        return reply.status(201).send(moment);
      },
    );

    app.get(
      "/moments",
      {
        schema: { querystring: listMomentsRequestSchema, response: { 200: momentPageSchema } },
        preHandler: requireUser,
      },
      async (request) =>
        moments.list(request.user.userId, request.query.limit, request.query.cursor),
    );

    app.patch(
      "/moments/:momentId",
      {
        schema: {
          params: z.object({ momentId: identifierSchema }),
          body: updateCaptionRequestSchema,
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.updateCaption(request.params.momentId, request.user.userId, request.body.caption),
    );

    // Its own endpoint rather than part of the patch above, because correcting
    // when something happened is not the same act as fixing a typo: it moves
    // the Moment through chronology, and `moments.md:443` asks that the two not
    // be flattened into one.
    app.put(
      "/moments/:momentId/occurrence",
      {
        schema: {
          params: z.object({ momentId: identifierSchema }),
          body: correctOccurrenceRequestSchema,
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.correctOccurrence(
          request.params.momentId,
          request.user.userId,
          request.body.occurrence,
          request.body.occurrenceOffsetMinutes,
        ),
    );

    app.post(
      "/moments/:momentId/media",
      {
        schema: {
          params: z.object({ momentId: identifierSchema }),
          body: addMediaRequestSchema,
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.addMedia(request.params.momentId, request.user.userId, request.body.uploadIds),
    );

    app.put(
      "/moments/:momentId/media/order",
      {
        schema: {
          params: z.object({ momentId: identifierSchema }),
          body: reorderMediaRequestSchema,
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.reorderMedia(request.params.momentId, request.user.userId, request.body.uploadIds),
    );

    app.delete(
      "/moments/:momentId/media/:uploadId",
      {
        schema: {
          params: z.object({ momentId: identifierSchema, uploadId: identifierSchema }),
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.removeMedium(
          request.params.momentId,
          request.user.userId,
          request.params.uploadId,
        ),
    );

    app.delete(
      "/moments/:momentId",
      {
        schema: {
          params: z.object({ momentId: identifierSchema }),
          response: { 204: z.null() },
        },
        preHandler: requireUser,
      },
      async (request, reply) => {
        await moments.delete(request.params.momentId, request.user.userId);

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
          params: z.object({ momentId: identifierSchema }),
          body: z.object({ locationId: identifierSchema }),
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.setLocation(
          request.params.momentId,
          request.user.userId,
          request.body.locationId,
        ),
    );

    app.delete(
      "/moments/:momentId/location",
      {
        schema: {
          params: z.object({ momentId: identifierSchema }),
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) => moments.clearLocation(request.params.momentId, request.user.userId),
    );

    app.post(
      "/moments/:momentId/real-world-events",
      {
        schema: {
          params: z.object({ momentId: identifierSchema }),
          body: z.object({ realWorldEventId: identifierSchema }),
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.addRealWorldEvent(
          request.params.momentId,
          request.user.userId,
          request.body.realWorldEventId,
        ),
    );

    app.delete(
      "/moments/:momentId/real-world-events/:realWorldEventId",
      {
        schema: {
          params: z.object({
            momentId: identifierSchema,
            realWorldEventId: identifierSchema,
          }),
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.removeRealWorldEvent(
          request.params.momentId,
          request.user.userId,
          request.params.realWorldEventId,
        ),
    );

    app.get(
      "/moments/:momentId",
      {
        schema: {
          params: z.object({ momentId: identifierSchema }),
          response: { 200: momentSchema },
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
          params: z.object({ momentId: identifierSchema }),
          body: setMomentVisibilityRequestSchema,
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.setVisibility(request.params.momentId, request.user.userId, request.body),
    );

    // Its own operation, and not folded into setting the place. Moving a Moment
    // to a different venue is not a decision to publish it.
    app.put(
      "/moments/:momentId/location/disclosure",
      {
        schema: {
          params: z.object({ momentId: identifierSchema }),
          body: setLocationDisclosureRequestSchema,
          response: { 200: momentSchema },
        },
        preHandler: requireUser,
      },
      async (request) =>
        moments.setLocationDisclosure(
          request.params.momentId,
          request.user.userId,
          request.body.disclosure,
        ),
    );

    // The author's own. A list of the people somebody trusted with something is
    // itself something to be trusted with, so there is no direction of this
    // that a Viewer can read.
    app.get(
      "/moments/:momentId/audience",
      {
        schema: {
          params: z.object({ momentId: identifierSchema }),
          response: { 200: momentAudienceSchema },
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
            params: z.object({ momentId: identifierSchema }),
            body: assertMomentRelationshipRequestSchema,
            response: { 201: momentRelationshipSchema },
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
            params: z.object({ momentId: identifierSchema }),
            response: { 200: momentRelationshipListSchema },
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
            params: z.object({
              momentId: identifierSchema,
              relationshipId: identifierSchema,
            }),
            response: { 204: z.null() },
          },
          preHandler: requireUser,
        },
        async (request, reply) => {
          await relationships.withdraw(request.params.relationshipId, request.user.userId);

          return reply.status(204).send(null);
        },
      );
    }

    // Somebody else's history, filtered to what this Viewer may see. Asking for
    // your own returns everything, exactly as `GET /moments` does.
    app.get(
      "/users/:userId/moments",
      {
        schema: {
          params: z.object({ userId: identifierSchema }),
          querystring: listMomentsRequestSchema,
          response: { 200: momentPageSchema },
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
