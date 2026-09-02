import { z } from "zod";
import { identifierSchema } from "./identifiers.js";
import { temporalPrecisionSchema, timestampSchema } from "./time.js";

/**
 * Discovery boundary contracts.
 *
 * Discovery puts history in front of somebody who did not ask for it, which is
 * a different act from answering a question and needs a stricter test:
 *
 * ```text
 * may view directly  !=  may be searched  !=  may be recommended
 * ```
 *
 * Nothing here carries a score. `discovery.md:85` separates Discovery from
 * historical truth, and a number beside a recommendation reads as a claim about
 * importance whatever it is labelled — the same reason Search returns no
 * relevance score.
 */

/**
 * Whether a Moment may be offered to somebody who did not ask.
 *
 * Separate from visibility. Unlisting leaves a Moment reachable by anybody
 * holding the link and takes it out of every recommendation surface — the
 * distinction `discovery.md:123` draws between being accessible and being
 * eligible for recommendation.
 */
export const setDiscoverabilityRequestSchema = z.object({
  discoverable: z.boolean(),
});

export type SetDiscoverabilityRequest = z.infer<typeof setDiscoverabilityRequestSchema>;

/** A Moment's discoverability, as its author sees it. */
export const discoverabilitySchema = z.object({
  momentId: identifierSchema,
  discoverable: z.boolean(),
});

export type Discoverability = z.infer<typeof discoverabilitySchema>;

/**
 * Why something was offered.
 *
 * Every reason names a property of the recommendation itself, which is already
 * eligible for whoever is reading it. That is what makes explanations safe by
 * construction rather than by filtering: none of them can say the thing
 * `discovery.md:187` warns about — that a friend attended a private Event —
 * because no reason here refers to anybody but the Viewer and the candidate.
 */
export const recommendationReasonSchema = z.enum([
  "significant",
  "same_event",
  "same_location",
  "causal_predecessor",
  "causal_consequence",
  "same_period",
]);

export type RecommendationReason = z.infer<typeof recommendationReasonSchema>;

/** One piece of history worth exploring. */
export const recommendationSchema = z.object({
  momentId: identifierSchema,
  title: z.string(),
  /** Whose it is. Always an account whose history is eligible to be offered. */
  authorUserId: identifierSchema,
  occurrence: z.object({
    start: timestampSchema,
    end: timestampSchema,
    precision: temporalPrecisionSchema,
  }),
  /**
   * Why this was offered, never empty.
   *
   * `discovery.md:1553` asks that enough provenance survive to identify the
   * contributing signal classes. A recommendation that cannot say why it is
   * here is one nobody can argue with.
   */
  because: z.array(recommendationReasonSchema).min(1),
});

export type Recommendation = z.infer<typeof recommendationSchema>;

/** A page of recommendations. */
export const recommendationPageSchema = z.object({
  recommendations: z.array(recommendationSchema),
  nextCursor: z.string().optional(),
});

export type RecommendationPage = z.infer<typeof recommendationPageSchema>;

/** What may be asked of a Discovery surface. */
export const discoveryRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(500).optional(),
});

export type DiscoveryRequest = z.infer<typeof discoveryRequestSchema>;

/**
 * What may be asked of Location discovery.
 *
 * A position is optional: a Location has its own place, and "history near
 * here" supplies one instead. Current position is query input and never
 * becomes historical content or visible presence (`discovery.md:277`).
 */
export const nearbyDiscoveryRequestSchema = discoveryRequestSchema.extend({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().min(1).max(20_000_000).optional(),
});

export type NearbyDiscoveryRequest = z.infer<typeof nearbyDiscoveryRequestSchema>;
