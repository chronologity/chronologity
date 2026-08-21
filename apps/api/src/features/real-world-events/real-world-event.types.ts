import type { Occurrence } from "@chronologity/contracts";

/** Feature-local types for real-world Events. */

/**
 * Everything established when an Event is recorded.
 *
 * The aliases and places have already been reduced by the policy, so the
 * repository stores what it is given rather than deciding anything.
 */
export interface NewRealWorldEvent {
  readonly realWorldEventId: string;
  readonly createdByUserId: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly occurrence: Occurrence;
  readonly locationIds: readonly string[];
  readonly createdAt: Date;
}
