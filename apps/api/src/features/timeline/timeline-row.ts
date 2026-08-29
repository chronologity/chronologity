import type { MomentVisibility, TemporalPrecision } from "@chronologity/contracts";

/**
 * A Moment as the Timeline holds it.
 *
 * Derived from authoritative state and authoritative for nothing. What it
 * carries is what chronological navigation needs — when the Moment happened,
 * whose it is, and whether this Viewer may be shown it — and deliberately not
 * what it says. A caption is read from PostgreSQL when a Moment is opened,
 * which is what keeps this table narrow and keeps a caption out of a store that
 * exists to be rebuilt.
 */
export interface TimelineRow {
  readonly momentId: string;
  readonly authorUserId: string;
  /**
   * When it happened. Never when it was recorded.
   *
   * A photograph uploaded today may belong to 1969, and placing it in 1969 is
   * the product rather than an edge case.
   */
  readonly occurredAt: Date;
  readonly occurrenceEnd: Date;
  /** What the occurrence actually claims, so a month is not shown as a day. */
  readonly occurrencePrecision: TemporalPrecision;
  readonly occurrenceOffsetMinutes: number;
  readonly visibility: MomentVisibility;
  readonly moderationState: string;
  /** Whether it may be offered to somebody who did not ask for it. */
  readonly discoverable: boolean;
}

/** The projection version live readers use. */
export const TIMELINE_VERSION = "timeline-v1";

/** What ClickHouse stores, which is not quite what TypeScript holds. */
export interface TimelineRecord {
  occurred_at: string;
  moment_id: string;
  author_user_id: string;
  projected_at: string;
  occurrence_end: string;
  occurrence_precision: string;
  occurrence_offset_minutes: number;
  visibility: string;
  moderation_state: string;
  discoverable: number;
  projection_version: string;
}

/**
 * A stored row, together with what this Viewer may do with it.
 *
 * `readable` is not a column and never could be: whether a Moment may be read
 * depends on who is asking, and the projection stores what is intrinsic to the
 * Moment. It is computed per query and carried alongside.
 *
 * It is 1 for every read that filtered on eligibility, since such a read
 * returns nothing else. It is 0 only on somebody's own Timeline, where a Moment
 * they accepted participation in but may not read appears as its date alone —
 * their own history should not have a hole they cannot see the shape of.
 */
export interface TimelineReading extends TimelineRecord {
  readable: number;
}

/**
 * ClickHouse wants a naive datetime string, not an ISO instant.
 *
 * `DateTime64(3)` has no zone: it stores what it is given. Handing it an ISO
 * string with a `Z` makes it parse the zone designator as part of the value or
 * refuse it, depending on the setting — so the conversion is explicit here
 * rather than left to whichever driver version is installed.
 *
 * @param at - The instant, which is always UTC by the time it reaches here.
 * @returns `YYYY-MM-DD HH:MM:SS.mmm`.
 */
export function asClickHouseDateTime(at: Date): string {
  return at.toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Turn a row into what ClickHouse stores.
 *
 * @param row - The Moment as the Timeline holds it.
 * @param projectedAt - When this projection ran, which is the version
 *   `ReplacingMergeTree` keeps when two rows share a sort key.
 * @param projectionVersion - Which projection wrote it, so a rebuild can fill a
 *   new version beside the live one.
 * @returns The record to insert.
 */
export function toRecord(
  row: TimelineRow,
  projectedAt: Date,
  projectionVersion: string,
): TimelineRecord {
  return {
    occurred_at: asClickHouseDateTime(row.occurredAt),
    moment_id: row.momentId,
    author_user_id: row.authorUserId,
    projected_at: asClickHouseDateTime(projectedAt),
    occurrence_end: asClickHouseDateTime(row.occurrenceEnd),
    occurrence_precision: row.occurrencePrecision,
    occurrence_offset_minutes: row.occurrenceOffsetMinutes,
    visibility: row.visibility,
    moderation_state: row.moderationState,
    // ClickHouse has no boolean; `UInt8` is the idiom and the conversion is
    // explicit so nobody has to remember which way round it went.
    discoverable: row.discoverable ? 1 : 0,
    projection_version: projectionVersion,
  };
}
