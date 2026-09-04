import {
  identifierSchema,
  timelineAroundRequestSchema,
  timelineAroundSchema,
  timelineBucketsRequestSchema,
  timelineBucketsSchema,
  timelineEntrySchema,
  timelineNarrowingSchema,
  timelinePageRequestSchema,
  timelinePageSchema,
  viewSpecificationSchema,
  type TimelineNarrowing,
  type ViewContext,
  type ViewSpecification,
  type TimelineScale,
} from "@chronologity/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ValidationError } from "../../lib/errors/validation-error.js";
import { requireUser } from "../../plugins/auth.plugin.js";
import { errors } from "../../server/error-responses.js";
import type { TimelineScopeRef } from "@chronologity/timeline-derivation";
import type { TimelineService } from "./timeline.service.js";

/**
 * Timeline navigation.
 *
 * Four shapes over one idea: history in the order it happened. Vertical
 * movement is chronology, and nothing here ranks — what decides order is when
 * something occurred, and engagement is not a signal the query can reach.
 *
 * Two families of surface. The unprefixed ones return your own history, where
 * the author is the Viewer and nothing else needs deciding. The scoped ones —
 * under a Location or a real-world Event — return everybody's, which is why
 * they resolve a Viewer's eligibility first and hand it to the query rather
 * than filtering a finished page. A page filtered afterwards discloses through
 * its size what it removed.
 *
 * @param timeline - The service these routes delegate to.
 * @returns A Fastify plugin registering the Timeline endpoints.
 */
export function timelineRoutes(timeline: TimelineService) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    // Grouped and deprecated in one place rather than sixteen. A hook for the
    // same reason the tag uses one: a route added here later is covered by
    // having been written, and marking fifteen of sixteen is the mistake this
    // shape makes impossible.
    //
    // Deprecated rather than removed (ADR-138). Nothing consumes these — mobile
    // arrives in Phase 11 and speaks GraphQL — but taking a working surface away
    // before its replacement exists is the riskier move. They go in Phase 10,
    // once the aggregator composes the same reads and it is clear what a client
    // actually needs.
    app.addHook("onRoute", (route) => {
      route.schema = {
        ...route.schema,
        tags: ["Timeline"],
        deprecated: true,
        description: [
          route.schema?.description,
          "",
          "**Going away.** Timeline reads move to the feed aggregator's GraphQL surface, which composes them for the client rather than returning one page at a time. This endpoint is removed once that surface is complete; nothing new should be built against it.",
        ]
          .filter((part) => part !== undefined)
          .join("\n"),
      };
    });

    /**
     * Assemble a View Specification from a request.
     *
     * The routes are entry points, not the interface. Each names a context in
     * its path and carries narrowing in its query string, and this turns the
     * two into the object the engine actually takes — the same object a Saved
     * View will store and a shared link will carry.
     *
     * @param context - What the path names.
     * @param query - What the query string asked for.
     * @returns The specification, refused if the combination is not a view.
     * @throws {ValidationError} If the query narrows by something the context
     *   already names, or asks a place for a lens only a person has.
     */
    const specificationFor = (
      context: ViewContext,
      query: Partial<TimelineNarrowing> & {
        cursor?: string | undefined;
        direction?: "older" | "newer" | undefined;
        limit?: number | undefined;
        at?: string | undefined;
        scale?: TimelineScale | undefined;
      },
    ): ViewSpecification => {
      const parsed = viewSpecificationSchema.safeParse({
        context,
        perspective: query.perspective ?? "all",
        filters: {
          ...(query.authorUserId === undefined ? {} : { authorUserId: query.authorUserId }),
          ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
          ...(query.realWorldEventId === undefined
            ? {}
            : { realWorldEventId: query.realWorldEventId }),
        },
        // Both ends or neither. A half-open range is likelier to be a client
        // dropping a parameter than somebody asking for everything since 1970.
        ...(query.from !== undefined && query.to !== undefined
          ? { range: { kind: "fixed" as const, from: query.from, to: query.to } }
          : {}),
        ...(query.scale === undefined ? {} : { zoom: query.scale }),
        position: {
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.at === undefined ? {} : { anchoredAt: query.at }),
        },
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.direction === undefined ? {} : { direction: query.direction }),
      });

      if (!parsed.success) {
        const issue = parsed.error.issues[0];

        throw new ValidationError(issue?.message ?? "That is not a usable view", {
          field: (issue?.path ?? ["view"]).join("."),
        });
      }

      return parsed.data;
    };


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
      async (request) =>
        timeline.derivePage(
          request.user.userId,
          specificationFor(ofPerson(request.user.userId), request.query),
        ),
    );

    app.get(
      "/timeline/head",
      {
        schema: {
          summary: "Where your Timeline opens",
          description:
            "The newest occurrence in your history, which is the default entry point. Not the most recently recorded Moment, and not the most anything else: a Timeline head is a position in time rather than a ranking.",
          querystring: timelineNarrowingSchema,
          response: {
            200: timelineEntrySchema.nullable(),
            ...errors(401),
          },
        },
        preHandler: requireUser,
      },
      async (request) =>
        (await timeline.deriveHead(
          request.user.userId,
          specificationFor(ofPerson(request.user.userId), request.query),
        )) ?? null,
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
        timeline.deriveAround(
          request.user.userId,
          specificationFor(ofPerson(request.user.userId), request.query),
        ),
    );

    app.get(
      "/timeline/buckets",
      {
        schema: {
          summary: "How your history is distributed",
          description: [
            "Counts per span, at any scale from a day to a century, for navigating where returning every Moment would be neither useful nor fast. Refused rather than shortened when the stretch and the scale together would be too many spans to answer.",
            "",
            "Spans holding nothing are absent rather than zero: a century you recorded nothing in is not a hundred empty rows. Counts agree with what paging returns.",
          ].join("\n"),
          querystring: timelineBucketsRequestSchema,
          response: { 200: timelineBucketsSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) => ({
        buckets: (
          await timeline.deriveBuckets(
            request.user.userId,
            specificationFor(ofPerson(request.user.userId), request.query),
          )
        ).map(
          (bucket) => ({ startsAt: bucket.startsAt.toISOString(), count: bucket.count }),
        ),
      }),
    );

    /**
     * The prose for a scope's four surfaces.
     *
     * Both scopes take the same shapes over the same eligibility rule, so what
     * a reader is told about them is written once. The routes themselves are
     * registered separately, because each needs its own path parameter and
     * Fastify infers a handler's parameter type from the literal schema.
     *
     * @param noun - How the scope is named in the generated descriptions.
     * @returns One description per surface.
     */
    const scopeDescriptions = (noun: string) => {
      const eligibility = [
        `**You see what you are entitled to see, and no sign of the rest.** A ${noun}'s history is written by many people, so every request resolves who you are first — whose history you have blocked or been blocked by, which restricted Moments here name you, whether you are old enough for age-restricted history — and filters on that inside the query rather than after it.`,
        "",
        `Consequently two people reading the same ${noun} see different history, counts included, and neither can tell from a page's size that anything was withheld. A ${noun} you may see nothing in answers empty rather than refusing, because refusing would itself disclose that there is something there.`,
      ].join("\n");

      return {
        page: [
          `Every Moment recorded at this ${noun} that you may see. Ordered by when they occurred, never by when they were recorded and never by anything resembling relevance.`,
          "",
          "Without a cursor this begins at the newest occurrence you may see and walks backwards.",
          "",
          eligibility,
          "",
          paging,
        ].join("\n"),

        head: [
          `The newest occurrence **you may see** here, which is where this ${noun}'s Timeline opens for you.`,
          "",
          `Deliberately yours rather than the ${noun}'s. A head naming a Moment you may not open would disclose that it exists, and roughly when it happened.`,
        ].join("\n"),

        around: [
          "Finds the Moment nearest an instant among those you may see here, and returns the history either side of it.",
          "",
          "The instant need not be one anything happened at. Nearest is decided after eligibility rather than before, so a jump never lands on something you cannot open.",
          "",
          "**This redefines the position as whichever Moment was nearest**, which `timeline.md:367` asks navigation not to do: a jump to a June nothing happened in is reported as the February before it, and nothing in the answer says so. The replacement surface preserves the position instead, returning it with nothing at it and the surrounding history either side. This is one of the reasons these routes are going away.",
          "",
          eligibility,
          "",
          paging,
        ].join("\n"),

        buckets: [
          "Counts per span, at any scale from a day to a century, over what you may see.",
          "",
          "Counts agree with what paging returns, which is the point: a bucket saying twelve where you may open four would advertise the eight. Spans holding nothing are absent rather than zero.",
        ].join("\n"),
      };
    };

    const location = scopeDescriptions("Location");
    const locationParams = z.object({ locationId: identifierSchema });

    /**
     * A Location's scope reference.
     *
     * @param locationId - The Location from the path.
     * @returns The reference the service takes.
     */
    const atLocation = (locationId: string): TimelineScopeRef => ({
      type: "location",
      id: locationId,
    });

    app.get(
      "/locations/:locationId/timeline",
      {
        schema: {
          summary: "A Location's history, in the order it happened",
          description: location.page,
          params: locationParams,
          querystring: timelinePageRequestSchema,
          response: { 200: timelinePageSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        timeline.derivePage(
          request.user.userId,
          specificationFor(atLocation(request.params.locationId), request.query),
        ),
    );

    app.get(
      "/locations/:locationId/timeline/head",
      {
        schema: {
          summary: "Where a Location's Timeline opens",
          description: location.head,
          params: locationParams,
          querystring: timelineNarrowingSchema,
          response: { 200: timelineEntrySchema.nullable(), ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        (await timeline.deriveHead(
          request.user.userId,
          specificationFor(atLocation(request.params.locationId), request.query),
        )) ?? null,
    );

    app.get(
      "/locations/:locationId/timeline/around",
      {
        schema: {
          summary: "Jump to a moment in a Location's history",
          description: location.around,
          params: locationParams,
          querystring: timelineAroundRequestSchema,
          response: { 200: timelineAroundSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        timeline.deriveAround(
          request.user.userId,
          specificationFor(atLocation(request.params.locationId), request.query),
        ),
    );

    app.get(
      "/locations/:locationId/timeline/buckets",
      {
        schema: {
          summary: "How a Location's history is distributed",
          description: location.buckets,
          params: locationParams,
          querystring: timelineBucketsRequestSchema,
          response: { 200: timelineBucketsSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) => ({
        buckets: (
          await timeline.deriveBuckets(
            request.user.userId,
            specificationFor(atLocation(request.params.locationId), request.query),
          )
        ).map((bucket) => ({ startsAt: bucket.startsAt.toISOString(), count: bucket.count })),
      }),
    );

    const event = scopeDescriptions("real-world Event");
    const eventParams = z.object({ realWorldEventId: identifierSchema });

    /**
     * A real-world Event's scope reference.
     *
     * @param realWorldEventId - The Event from the path.
     * @returns The reference the service takes.
     */
    const atEvent = (realWorldEventId: string): TimelineScopeRef => ({
      type: "real_world_event",
      id: realWorldEventId,
    });

    app.get(
      "/real-world-events/:realWorldEventId/timeline",
      {
        schema: {
          summary: "A real-world Event's history, in the order it happened",
          description: event.page,
          params: eventParams,
          querystring: timelinePageRequestSchema,
          response: { 200: timelinePageSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        timeline.derivePage(
          request.user.userId,
          specificationFor(atEvent(request.params.realWorldEventId), request.query),
        ),
    );

    app.get(
      "/real-world-events/:realWorldEventId/timeline/head",
      {
        schema: {
          summary: "Where a real-world Event's Timeline opens",
          description: event.head,
          params: eventParams,
          querystring: timelineNarrowingSchema,
          response: { 200: timelineEntrySchema.nullable(), ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        (await timeline.deriveHead(
          request.user.userId,
          specificationFor(atEvent(request.params.realWorldEventId), request.query),
        )) ?? null,
    );

    app.get(
      "/real-world-events/:realWorldEventId/timeline/around",
      {
        schema: {
          summary: "Jump to a moment in a real-world Event's history",
          description: event.around,
          params: eventParams,
          querystring: timelineAroundRequestSchema,
          response: { 200: timelineAroundSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        timeline.deriveAround(
          request.user.userId,
          specificationFor(atEvent(request.params.realWorldEventId), request.query),
        ),
    );

    app.get(
      "/real-world-events/:realWorldEventId/timeline/buckets",
      {
        schema: {
          summary: "How a real-world Event's history is distributed",
          description: event.buckets,
          params: eventParams,
          querystring: timelineBucketsRequestSchema,
          response: { 200: timelineBucketsSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) => ({
        buckets: (
          await timeline.deriveBuckets(
            request.user.userId,
            specificationFor(atEvent(request.params.realWorldEventId), request.query),
          )
        ).map((bucket) => ({ startsAt: bucket.startsAt.toISOString(), count: bucket.count })),
      }),
    );


    const person = scopeDescriptions("person");
    const personParams = z.object({ userId: identifierSchema });

    /**
     * A person's Timeline, as a scope.
     *
     * @param userId - Whose history.
     * @returns The reference the service takes.
     */
    const ofPerson = (userId: string): TimelineScopeRef => ({ type: "person", id: userId });

    const personNote = [
      "**Their history is what they recorded together with what they agreed they were part of.** Somebody who was at an occasion but did not photograph it was still there, and a product where only the person holding the camera owns the memory would record who documented history rather than what happened.",
      "",
      "**You see only what you were already entitled to see.** Being on somebody's Timeline widens nothing: each Moment's own audience still decides, so this can never show you something you could not have opened one at a time.",
      "",
      "**A Timeline you may see nothing in answers empty rather than refusing** — as does one belonging to somebody who has turned theirs off, or blocked you, or been suspended. Refusing would itself say there is something here.",
    ].join("\n");

    app.get(
      "/users/:userId/timeline",
      {
        schema: {
          summary: "A person's history, in the order it happened",
          description: [person.page, "", personNote].join("\n"),
          params: personParams,
          querystring: timelinePageRequestSchema,
          response: { 200: timelinePageSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        // Their own Timeline is read by the own path rather than this one.
        // Otherwise a Moment they participated in but cannot read would be
        // filtered out here while `/timeline` returns it redacted, and the two
        // surfaces would disagree about the same person's history. The engine
        // decides that from the context now, so there is nothing to branch on.
        timeline.derivePage(
          request.user.userId,
          specificationFor(ofPerson(request.params.userId), request.query),
        ),
    );

    app.get(
      "/users/:userId/timeline/head",
      {
        schema: {
          summary: "Where a person's Timeline opens",
          description: [person.head, "", personNote].join("\n"),
          params: personParams,
          querystring: timelineNarrowingSchema,
          response: { 200: timelineEntrySchema.nullable(), ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        (await timeline.deriveHead(
          request.user.userId,
          specificationFor(ofPerson(request.params.userId), request.query),
        )) ?? null,
    );

    app.get(
      "/users/:userId/timeline/around",
      {
        schema: {
          summary: "Jump to a moment in a person's history",
          description: [person.around, "", personNote].join("\n"),
          params: personParams,
          querystring: timelineAroundRequestSchema,
          response: { 200: timelineAroundSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        timeline.deriveAround(
          request.user.userId,
          specificationFor(ofPerson(request.params.userId), request.query),
        ),
    );

    app.get(
      "/users/:userId/timeline/buckets",
      {
        schema: {
          summary: "How a person's history is distributed",
          description: [person.buckets, "", personNote].join("\n"),
          params: personParams,
          querystring: timelineBucketsRequestSchema,
          response: { 200: timelineBucketsSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) => ({
        buckets: (
          await timeline.deriveBuckets(
            request.user.userId,
            specificationFor(ofPerson(request.params.userId), request.query),
          )
        ).map((bucket) => ({ startsAt: bucket.startsAt.toISOString(), count: bucket.count })),
      }),
    );

  };
}
