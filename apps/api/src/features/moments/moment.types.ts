import type { Occurrence } from "@chronologity/contracts";

/** Feature-local types for Moments. */

/** Everything established when a Moment is recorded. */
export interface NewMoment {
  readonly momentId: string;
  readonly authorUserId: string;
  readonly caption: string;
  readonly occurrence: Occurrence;
  readonly occurrenceOffsetMinutes: number;
  /** Already checked and positioned by the policy. */
  readonly media: readonly { uploadId: string; position: number }[];
  readonly createdAt: Date;
}

/**
 * Where a page of Moments continues from.
 *
 * Both halves are needed: the occurrence orders the page, and the identifier
 * settles ties so that two Moments sharing a time cannot be skipped or repeated
 * across a page boundary.
 */
export interface MomentCursor {
  readonly occurrenceStart: Date;
  readonly momentId: string;
}
