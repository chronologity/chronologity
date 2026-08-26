import { z } from "zod";
import { identifierSchema } from "./identifiers.js";
import { temporalPrecisionSchema, timestampSchema } from "./time.js";

/**
 * Search boundary contracts.
 *
 * One entry point rather than one per kind of thing, and results always carry
 * what they are. `search.md:117` asks that unified Search "preserve entity type
 * so Users understand what each result represents" and warns against flattening
 * history into an undifferentiated list of media posts.
 *
 * Search is a way of finding history, never a claim about it. Nothing here
 * carries a relevance score or a significance number: `search.md:67` separates
 * relevance from historical significance, and a number presented beside a
 * result reads as a judgement about the past whatever it is labelled.
 */

/** What a result is. */
export const searchEntityTypeSchema = z.enum(["moment", "user", "event", "location"]);

export type SearchEntityType = z.infer<typeof searchEntityTypeSchema>;

/**
 * How results are ordered.
 *
 * Explicit in the request, never inferred. When a chronological mode is chosen,
 * occurrence governs the order and relevance plays no part at all
 * (`search.md:399`).
 */
export const searchSortSchema = z.enum(["relevance", "occurrence_new", "occurrence_old"]);

export type SearchSort = z.infer<typeof searchSortSchema>;

/**
 * How exact a proximity answer was.
 *
 * Travels with the results the way temporal precision travels with an
 * occurrence. A 200 metre radius cannot be honoured by a five kilometre cell,
 * and rounding it away silently would be the geographic version of inventing a
 * day for a summer nobody dated.
 */
export const geoPrecisionSchema = z.enum(["exact", "neighbourhood", "region"]);

export type GeoPrecision = z.infer<typeof geoPrecisionSchema>;

/**
 * Why a result matched.
 *
 * Derived from the signals that actually contributed, not reconstructed
 * afterwards by a client. `search.md:421` does not require exposing every
 * ranking weight, but says being unable to explain an obvious result is not
 * acceptable.
 */
export const matchReasonSchema = z.enum([
  "exact_title_match",
  "title_match",
  "alias_match",
  "caption_match",
  "event_match",
  "location_match",
  "temporal_match",
  "proximity_match",
  "creator_match",
]);

export type MatchReason = z.infer<typeof matchReasonSchema>;

/** One thing found. */
export const searchResultSchema = z.object({
  entityType: searchEntityTypeSchema,
  entityId: identifierSchema,
  /** What it is called. */
  title: z.string(),
  /**
   * A fragment of the matching text, with the matched words marked.
   *
   * Generated at query time from indexed text the Viewer is entitled to, and it
   * never widens what the result already discloses. Highlighting explains why
   * something matched and implies nothing about whether it is important.
   */
  snippet: z.string().nullable(),
  /** Absent for a User or a Location, which are not occurrences. */
  occurrence: z
    .object({
      start: timestampSchema,
      end: timestampSchema,
      precision: temporalPrecisionSchema,
    })
    .nullable(),
  /**
   * Which signals contributed. Never empty: something matched, or this would
   * not be here.
   */
  matchedOn: z.array(matchReasonSchema).min(1),
});

export type SearchResult = z.infer<typeof searchResultSchema>;

/**
 * A page of results.
 *
 * `total` counts eligible candidates only. A count computed before eligibility
 * would report how much was withheld, which is a disclosure in itself —
 * `search.md:259` requires counts and zero-result states to be computed over
 * eligible candidates.
 */
export const searchPageSchema = z.object({
  results: z.array(searchResultSchema),
  total: z.number().int().min(0),
  /**
   * How exact the proximity filter could actually be, when one was given.
   *
   * Absent when the search was not geographic.
   */
  geoPrecision: geoPrecisionSchema.optional(),
  nextCursor: z.string().optional(),
});

export type SearchPage = z.infer<typeof searchPageSchema>;

/**
 * What may be asked.
 *
 * Every field is bounded. A Search surface takes text from anybody and turns it
 * into a query, and an unbounded one is a way to make the database do arbitrary
 * work on request.
 */
export const searchRequestSchema = z
  .object({
    /** The words. Optional when a filter narrows the search instead. */
    q: z.string().trim().max(200).optional(),
    /** Restrict to one kind of thing. Omitted searches all four. */
    type: searchEntityTypeSchema.optional(),
    sort: searchSortSchema.default("relevance"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().max(500).optional(),
    /**
     * The occurrence window, as an overlap rather than a containment.
     *
     * A Moment known only as "summer 1998" belongs in a search for 1998 and
     * must not acquire a fabricated exact timestamp to make the comparison
     * easier (`search.md:275`).
     */
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
    /** Only things this person recorded. */
    creator: identifierSchema.optional(),
    /** Only things at this place. */
    locationId: identifierSchema.optional(),
    /** Only things that were part of this occurrence. */
    realWorldEventId: identifierSchema.optional(),
    /** Search around a point. Both parts are required together. */
    lat: z.coerce.number().min(-90).max(90).optional(),
    lon: z.coerce.number().min(-180).max(180).optional(),
    /** How far around it to look, in metres. */
    radius: z.coerce.number().min(1).max(20_000_000).optional(),
  })
  .refine((body) => (body.lat === undefined) === (body.lon === undefined), {
    message: "A position needs both a latitude and a longitude",
    path: ["lat"],
  })
  .refine((body) => body.radius === undefined || body.lat !== undefined, {
    message: "A radius needs a position to be measured from",
    path: ["radius"],
  })
  .refine((body) => body.from === undefined || body.to === undefined || body.from <= body.to, {
    message: "The window ends before it begins",
    path: ["to"],
  })
  .refine(
    (body) =>
      body.q !== undefined ||
      body.creator !== undefined ||
      body.locationId !== undefined ||
      body.realWorldEventId !== undefined ||
      body.from !== undefined ||
      body.to !== undefined ||
      body.lat !== undefined,
    { message: "Give something to search for", path: ["q"] },
  );

export type SearchRequest = z.infer<typeof searchRequestSchema>;
