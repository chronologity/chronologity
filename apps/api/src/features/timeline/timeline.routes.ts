import {
  timelineAroundRequestSchema,
  timelineAroundSchema,
  timelineBucketsRequestSchema,
  timelineBucketsSchema,
  timelineEntrySchema,
  timelinePageRequestSchema,
  timelinePageSchema,
} from "@chronologity/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireUser } from "../../plugins/auth.plugin.js";
import { errors } from "../../server/error-responses.js";
import type { TimelineService } from "./timeline.service.js";

/**
 * Timeline navigation.
 *
 * Three surfaces over one idea: history in the order it happened. Vertical
 * movement is chronology, and nothing here ranks — what decides order is when
 * something occurred, and engagement is not a signal the query can reach.
 *
 * **These return your own history and nobody else's.** Not a limitation of the
 * endpoints but of what can currently be answered correctly: filtering somebody
 * else's Timeline needs suspensions, Blocks and audiences, which live in
 * PostgreSQL while these rows live in ClickHouse. Until that bridge exists the
 * author is the Viewer, applied in the query rather than after it.
 *
 * @param timeline - The service these routes delegate to.
 * @returns A Fastify plugin registering the Timeline endpoints.
 */
export function timelineRoutes(timeline: TimelineService) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.addHook("onRoute", (route) => {
      route.schema = { ...route.schema, tags: ["Timeline"] };
    });

    const paging = [
      "**Positions, not page numbers.** A cursor names a place in history rather than a count of rows, because history grows in the middle: a photograph uploaded today may belong to 1969 and lands between two pages you have already seen. Paging by offset would repeat one Moment and skip another every time that happened.",
      "",
      "**A cursor is opaque.** It encodes where to resume and nothing a client should read or construct. One this system did not issue is refused rather than interpreted.",
      "",
      "**Both directions cost the same.** Every page carries a cursor at each end, so going back towards the present is one request from wherever you are, not a position you had to keep.",
    ].join("\n");

    app.get(
      "/timeline",
      {
        schema: {
          summary: "Your history, in the order it happened",
          description: [
            "Ordered by when Moments occurred, never by when they were recorded and never by anything resembling relevance. A Moment added today about 1969 appears in 1969.",
            "",
            "Without a cursor this begins at the newest occurrence and walks backwards, which is where a Timeline opens.",
            "",
            paging,
          ].join("\n"),
          querystring: timelinePageRequestSchema,
          response: { 200: timelinePageSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) => timeline.page(request.user.userId, request.query),
    );

    app.get(
      "/timeline/head",
      {
        schema: {
          summary: "Where your Timeline opens",
          description:
            "The newest occurrence in your history, which is the default entry point. Not the most recently recorded Moment, and not the most anything else: a Timeline head is a position in time rather than a ranking.",
          response: {
            200: timelineEntrySchema.nullable(),
            ...errors(401),
          },
        },
        preHandler: requireUser,
      },
      async (request) => (await timeline.head(request.user.userId)) ?? null,
    );

    app.get(
      "/timeline/around",
      {
        schema: {
          summary: "Jump to a moment in time",
          description: [
            "Finds the Moment nearest an instant and returns the history either side of it, so navigation continues immediately rather than after a second request.",
            "",
            "The instant need not be one anything happened at. Asking about a quiet decade lands on whichever Moment is closest; asking about a time before all your history lands on its beginning. A Viewer with no history gets an empty answer rather than an error.",
            "",
            paging,
          ].join("\n"),
          querystring: timelineAroundRequestSchema,
          response: { 200: timelineAroundSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        timeline.around(request.user.userId, new Date(request.query.at), request.query.limit),
    );

    app.get(
      "/timeline/buckets",
      {
        schema: {
          summary: "How your history is distributed",
          description: [
            "Counts per year or per decade, for navigating at a scale where returning every Moment would be neither useful nor fast.",
            "",
            "Spans holding nothing are absent rather than zero: a century you recorded nothing in is not a hundred empty rows. Counts agree with what paging returns.",
          ].join("\n"),
          querystring: timelineBucketsRequestSchema,
          response: { 200: timelineBucketsSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) => ({
        buckets: (await timeline.buckets(request.user.userId, request.query.scale)).map(
          (bucket) => ({ startsAt: bucket.startsAt.toISOString(), count: bucket.count }),
        ),
      }),
    );
  };
}
