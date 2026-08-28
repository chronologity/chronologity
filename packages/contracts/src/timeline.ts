import { z } from "zod";
import { identifierSchema } from "./identifiers.js";
import { temporalPrecisionSchema, timestampSchema } from "./time.js";
import { momentVisibilitySchema } from "./moments.js";

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

/** How coarsely history is being viewed. */
export const timelineScaleSchema = z.enum(["year", "decade"]);

export type TimelineScale = z.infer<typeof timelineScaleSchema>;

/**
 * A Moment as the Timeline presents it.
 *
 * Deliberately thin: where a Moment sits in history and what its occurrence
 * claims, and nothing it says. A caption is read when a Moment is opened, which
 * keeps the read model narrow and keeps somebody's words out of a store that
 * exists to be rebuilt.
 */
export const timelineEntrySchema = z.object({
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
export const timelinePageRequestSchema = z.object({
  cursor: z.string().max(500).optional(),
  direction: timelineDirectionSchema.default("older"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type TimelinePageRequest = z.infer<typeof timelinePageRequestSchema>;

/** Asking what surrounds a moment in time. */
export const timelineAroundRequestSchema = z.object({
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
export const timelineBucketsRequestSchema = z.object({ scale: timelineScaleSchema });

export type TimelineBucketsRequest = z.infer<typeof timelineBucketsRequestSchema>;

/**
 * Counts per span, oldest first.
 *
 * Spans holding nothing are absent rather than zero: a century of silence is
 * not a hundred rows of nothing.
 */
export const timelineBucketsSchema = z.object({ buckets: z.array(timelineBucketSchema) });

export type TimelineBuckets = z.infer<typeof timelineBucketsSchema>;
