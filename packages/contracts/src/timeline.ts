import { z } from "zod";
import { identifierSchema } from "./identifiers.js";
import { temporalPrecisionSchema, timestampSchema } from "./time.js";
import { momentVisibilitySchema } from "./moments.js";
import { viewPerspectiveSchema } from "./view-specification.js";
import { timelineScaleSchema } from "./spans.js";

/**
 * Navigating history.
 *
 * The Timeline is chronological and never ranked: what decides order is when
 * something happened, and nothing about engagement or relevance enters into it.
 * These contracts carry positions rather than page numbers for the reason
 * `timeline.md:776` gives — history grows in the middle, so an offset taken a
 * moment ago now points somewhere else.
 */

/** Which way a page runs through history. */
export const timelineDirectionSchema = z.enum(["older", "newer"]);

export type TimelineDirection = z.infer<typeof timelineDirectionSchema>;

/**
 * A Moment as the Timeline presents it.
 *
 * Deliberately thin: where a Moment sits in history and what its occurrence
 * claims, and nothing it says. A caption is read when a Moment is opened, which
 * keeps the read model narrow and keeps somebody's words out of a store that
 * exists to be rebuilt.
 */
export const readableTimelineEntrySchema = z.object({
  readable: z.literal(true),
  momentId: identifierSchema,
  /** When it happened. Never when it was recorded. */
  occurredAt: timestampSchema,
  occurrenceEnd: timestampSchema,
  /** What the occurrence claims, so a month is not presented as a day. */
  occurrencePrecision: temporalPrecisionSchema,
  occurrenceOffsetMinutes: z.number().int(),
  visibility: momentVisibilitySchema,
  discoverable: z.boolean(),
});

export type ReadableTimelineEntry = z.infer<typeof readableTimelineEntrySchema>;

/**
 * A Moment somebody was part of and may not read.
 *
 * Appears only on that person's own Timeline, and carries when it happened and
 * nothing else. They accepted participation, so they are entitled to know it
 * happened — their own history should not have a hole they cannot see the shape
 * of — but accepting granted them nothing, so what it says stays shut.
 *
 * Deliberately a separate shape rather than the same one with fields left out.
 * A client cannot read a field that is absent, and a missing field is
 * indistinguishable from one that was never sent; a tag cannot be mistaken for
 * either.
 *
 * **No `occurrenceOffsetMinutes`.** A UTC offset is a weak statement about
 * where somebody was, and it is the one field in the occurrence set that says
 * anything about place rather than time. Times come back in UTC.
 */
export const withheldTimelineEntrySchema = z.object({
  readable: z.literal(false),
  momentId: identifierSchema,
  occurredAt: timestampSchema,
  occurrenceEnd: timestampSchema,
  occurrencePrecision: temporalPrecisionSchema,
});

export type WithheldTimelineEntry = z.infer<typeof withheldTimelineEntrySchema>;

/**
 * A Moment as a Timeline presents it.
 *
 * Two shapes, told apart by `readable`. Everything a scope Timeline returns is
 * readable, because such a read filters rather than reports; only somebody's
 * own Timeline can carry the other.
 */
export const timelineEntrySchema = z.discriminatedUnion("readable", [
  readableTimelineEntrySchema,
  withheldTimelineEntrySchema,
]);

export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

/** A page of history, and where to continue from in either direction. */
export const timelinePageSchema = z.object({
  moments: z.array(timelineEntrySchema),
  /**
   * Where the next page in the direction of travel resumes.
   *
   * Absent when history ran out. Opaque: it names a position, and its shape is
   * this system's business rather than a client's.
   */
  cursor: z.string().optional(),
  /** Where a page in the opposite direction resumes, so neither is harder. */
  reverseCursor: z.string().optional(),
});

export type TimelinePage = z.infer<typeof timelinePageSchema>;

/** Asking for a page. */
/**
 * What every Timeline request may narrow by.
 *
 * The specification's fields, as a client sends them. A route assembles these
 * into a View Specification along with the context its path names — so a
 * request and a Saved View describe the same thing in the same vocabulary,
 * which is what stops the two drifting apart.
 */
export const timelineNarrowingSchema = z.object({
  /**
   * Which lens on the context's Moments.
   *
   * Only a person's Timeline has more than one: their history is what they
   * recorded together with what they took part in, and the two are different
   * questions about the same person.
   */
  perspective: viewPerspectiveSchema.default("all"),
  /** Only Moments this person recorded. */
  authorUserId: identifierSchema.optional(),
  /** Only Moments at this place. */
  locationId: identifierSchema.optional(),
  /** Only Moments that were part of this occurrence. */
  realWorldEventId: identifierSchema.optional(),
  /** The start of a stretch of history, by when things happened. */
  from: timestampSchema.optional(),
  /** Its end. */
  to: timestampSchema.optional(),
});

export type TimelineNarrowing = z.infer<typeof timelineNarrowingSchema>;

export const timelinePageRequestSchema = timelineNarrowingSchema.extend({
  cursor: z.string().max(500).optional(),
  direction: timelineDirectionSchema.default("older"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type TimelinePageRequest = z.infer<typeof timelinePageRequestSchema>;

/** Asking what surrounds a moment in time. */
export const timelineAroundRequestSchema = timelineNarrowingSchema.extend({
  /** The instant asked about, which need not be one anything happened. */
  at: timestampSchema,
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type TimelineAroundRequest = z.infer<typeof timelineAroundRequestSchema>;

/** Where a jump landed, and the history either side of it. */
export const timelineAroundSchema = z.object({
  /** The nearest Moment, or absent when there is no history at all. */
  at: timelineEntrySchema.optional(),
  older: timelinePageSchema,
  newer: timelinePageSchema,
});

export type TimelineAround = z.infer<typeof timelineAroundSchema>;

/** How much history sits in one span of time. */
export const timelineBucketSchema = z.object({
  startsAt: timestampSchema,
  count: z.number().int().nonnegative(),
});

/** Asking how history is distributed. */
export const timelineBucketsRequestSchema = timelineNarrowingSchema.extend({
  scale: timelineScaleSchema,
});

export type TimelineBucketsRequest = z.infer<typeof timelineBucketsRequestSchema>;

/**
 * Counts per span, oldest first.
 *
 * Spans holding nothing are absent rather than zero: a century of silence is
 * not a hundred rows of nothing.
 */
export const timelineBucketsSchema = z.object({ buckets: z.array(timelineBucketSchema) });

export type TimelineBuckets = z.infer<typeof timelineBucketsSchema>;

/**
 * How a context sits beside the one somebody is standing in.
 *
 * Two tiers, and the distinction is load-bearing rather than descriptive.
 * `SHARED_HISTORY` is a fact somebody recorded: a Moment belongs to both. Being
 * in the same period is not a relationship at all — it says only that two
 * stretches of history reach the same time, which `timeline.md:112` is explicit
 * does not prove anything connects them.
 *
 * Carried as data rather than left to the order results arrive in, because order
 * is not durable: a client that sorts or filters loses it, and mere co-presence
 * then reads as connection.
 */
export const contextAdjacencySchema = z.enum(["shared_history", "same_period"]);

export type ContextAdjacency = z.infer<typeof contextAdjacencySchema>;

/**
 * What a caller may ask for when moving sideways through history.
 *
 * Bounded because the axis is not. Horizontal movement never runs out — beyond
 * the contexts sharing history with where somebody is standing, it continues
 * into whatever else reaches the same period — so a page bound is what keeps one
 * request from asking for the whole of it.
 */
export const listAdjacentContextsRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(500).optional(),
});

export type ListAdjacentContextsRequest = z.infer<typeof listAdjacentContextsRequestSchema>;
