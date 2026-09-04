import type { BucketRow } from "../../read-models/clickhouse/timeline-read-model.js";
import type { RepresentativeRow } from "../../read-models/postgres/representative-read-model.js";
import { asEnum, instantOf, type ReadableEntry } from "./timeline-composer.js";
import type { DistributionRequest } from "./distribution-request.js";

/**
 * Putting two stores' answers together into one shape.
 *
 * **Counts decide which spans exist. Representatives only decorate them.** The
 * two statements run against different engines and neither waits for the other,
 * so they can disagree — a Moment recorded seconds ago is in PostgreSQL and not
 * yet in the projection; one erased between the two statements is counted and
 * has nothing to show; one recorded for 1850 cannot be in the projection at all,
 * because that store's calendar begins in 1900. A representative for a span
 * nothing counted is dropped, by rule, and that one sentence covers every case
 * without any of them needing to be detected.
 *
 * The disagreement can only run one way. PostgreSQL holds the authoritative
 * visibility rule and is the more permissive of the two, so a representative can
 * appear that the count under-reported — never the reverse. Under-reporting is
 * the safe direction, and it is not a disclosure: the authoritative rule said
 * this reader may read it.
 *
 * So a span carrying a count of forty and one representative is an ordinary
 * answer, not a fault. So is a count of one and no representatives at all.
 */

/** One span of history, and a little of what was in it. */
export interface TemporalBucket {
  readonly startsAt: Date;
  /**
   * How much history the span holds.
   *
   * What this reader may be told about, which on their own Timeline includes
   * Moments they may not read and on anybody else's does not. Never a count of
   * the representatives: those are what may be *shown*, and fewer.
   */
  readonly count: number;
  readonly representatives: readonly ReadableEntry[];
}

/** How history is distributed across a stretch of time. */
export interface TemporalDistribution {
  readonly buckets: readonly TemporalBucket[];
  readonly scale: string;
  /**
   * The interval actually read.
   *
   * Returned rather than assumed. A rolling range resolves against the instant
   * the request arrived, which a client cannot recompute — and without these it
   * could not know which empty spans to draw for itself.
   */
  readonly from: Date;
  readonly to: Date;
  readonly scope: { readonly type: string; readonly id: string };
}

/**
 * Assemble the answer.
 *
 * @param request - What was asked for, carrying the scope, the scale and the
 *   interval that was read.
 * @param counts - One row per span holding anything, oldest first.
 * @param representatives - The chosen Moments, or none when the client did not
 *   ask for any and the statement was never issued.
 * @returns The distribution, spans oldest first, each span's representatives in
 *   the order they were ranked.
 */
export function distributionFrom(
  request: DistributionRequest,
  counts: readonly BucketRow[],
  representatives: readonly RepresentativeRow[],
): TemporalDistribution {
  // Keyed on the instant rather than on how either store renders it. ClickHouse
  // returns a naive `1969-01-01 00:00:00.000` and `pg` returns a Date; joining
  // on text would work until a format or a zone changed under it, and would then
  // fail as silently as it had worked.
  const bySpan = new Map<number, ReadableEntry[]>();

  for (const row of representatives) {
    const span = row.starts_at.getTime();
    const chosen = bySpan.get(span);
    const entry = entryOf(row);

    if (chosen === undefined) {
      bySpan.set(span, [entry]);
    } else {
      chosen.push(entry);
    }
  }

  return {
    buckets: counts.map((row) => {
      const startsAt = instantOf(row.starts_at);

      return {
        startsAt,
        count: row.count,
        // Empty rather than absent. A null list is indistinguishable from one
        // that failed to load, and a span whose history this reader may not read
        // is an ordinary answer.
        representatives: bySpan.get(startsAt.getTime()) ?? [],
      };
    }),
    scale: asEnum(request.scale),
    from: request.from,
    to: request.to,
    scope: { type: asEnum(request.view.context.type), id: request.view.context.id },
  };
}

/**
 * A chosen row as a client sees it.
 *
 * @param row - The row, already proven readable by the statement that found it.
 * @returns The entry, in the same shape a Timeline page presents — so a client
 *   drilling from a span into the history behind it renders one thing, not two.
 */
function entryOf(row: RepresentativeRow): ReadableEntry {
  return {
    readable: true,
    momentId: row.moment_id,
    occurredAt: row.occurrence_start,
    occurrenceEnd: row.occurrence_end,
    occurrencePrecision: asEnum(row.occurrence_precision),
    occurrenceOffsetMinutes: row.occurrence_offset_minutes,
    visibility: asEnum(row.visibility),
    discoverable: row.discoverable,
  };
}
