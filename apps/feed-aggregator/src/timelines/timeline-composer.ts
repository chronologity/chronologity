import type { ViewSpecification } from "@chronologity/contracts";
import type { TimelinePosition, TimelineReading } from "@chronologity/timeline-derivation";
import type { TimelineSlice } from "../read-models/clickhouse/timeline-read-model.js";

/**
 * Turning rows into a page a GraphQL client already knows how to read.
 *
 * Everything shaped rather than decided. What a Viewer may see was settled
 * before the query ran and applied inside it; this arranges what came back into
 * edges, a `pageInfo` and the scope — and redacts the one kind of row that
 * comes back reported rather than filtered.
 *
 * **A page is always ordered newest first**, whichever way it was walked. A
 * backward page arrives oldest first, because that is the order the keyset
 * condition walks it in, and is reversed here. That reversal is what makes
 * paging back and then forward return the same Moments in the same order —
 * `timeline.md:824` names asymmetric navigation as the defect to avoid, and a
 * page that read backwards depending on how it was reached would be exactly
 * that.
 */

/** A Moment as a Timeline presents it, to somebody entitled to read it. */
export interface ReadableEntry {
  /**
   * Which member of the union this is.
   *
   * Not a schema field: the SDL has two types rather than one with a flag, so a
   * client cannot read a field that is not there. This is what `resolveType`
   * decides from, and it is carried on the value rather than recomputed.
   */
  readonly readable: true;
  readonly momentId: string;
  readonly occurredAt: Date;
  readonly occurrenceEnd: Date;
  readonly occurrencePrecision: string;
  readonly occurrenceOffsetMinutes: number;
  readonly visibility: string;
  readonly discoverable: boolean;
}

/**
 * A Moment somebody was part of and may not read.
 *
 * Its date and nothing else. They accepted participation, so they are entitled
 * to know it happened — their own history should not have a hole they cannot
 * see the shape of — but accepting granted them nothing, so what it says stays
 * shut.
 *
 * **No offset.** A UTC offset is a weak statement about where somebody was,
 * which is the one occurrence field that says anything about place rather than
 * time, and this person was told when and nothing more when they were asked.
 */
export interface WithheldEntry {
  readonly readable: false;
  readonly momentId: string;
  readonly occurredAt: Date;
  readonly occurrenceEnd: Date;
  readonly occurrencePrecision: string;
}

/** A Moment in a Timeline, readable or not. */
export type TimelineEntry = ReadableEntry | WithheldEntry;

/** One Moment in a page, with the position it sits at. */
export interface TimelineEdge {
  /** Serialised by the `Cursor` scalar, which is what makes it opaque. */
  readonly cursor: TimelinePosition;
  readonly node: TimelineEntry;
}

/** Where a page sits, and whether there is more history either side of it. */
export interface TimelinePageInfo {
  readonly startCursor: TimelinePosition | null;
  readonly endCursor: TimelinePosition | null;
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
}

/** A page of history, and whose it is. */
export interface TimelineConnection {
  readonly edges: readonly TimelineEdge[];
  readonly pageInfo: TimelinePageInfo;
  readonly scope: { readonly type: string; readonly id: string };
}

/**
 * Arrange a slice into a connection.
 *
 * Both sides of `pageInfo` are answered from the one query. A Timeline runs
 * newest first, so `hasNextPage` means history continues further back and
 * `hasPreviousPage` means there is more between here and the present. Walking
 * into the past, the probe row answers the first and the cursor answers the
 * second; walking towards the present, they swap.
 *
 * The cursor answers its side **exactly**, because every cursor this service
 * issues was taken from a row it returned: when a client supplies one, a row
 * exists on the near side of the page by construction. The one case where that
 * is generous rather than exact is a cursor whose Moment has since been erased,
 * where following it back yields an empty page — a better answer than paying a
 * second query on every page to rule out a case that almost never happens.
 *
 * @param slice - The rows and whether history continues past them.
 * @param view - What was asked for, for its direction and its scope.
 * @param resumed - Whether the request supplied a cursor, which is what says
 *   there is a page on the near side to go back to.
 * @returns The connection, ordered newest first.
 */
export function connectionFor(
  slice: TimelineSlice,
  view: ViewSpecification,
  resumed: boolean,
): TimelineConnection {
  const backward = view.direction === "newer";
  const rows = backward ? [...slice.rows].reverse() : slice.rows;
  const edges = rows.map((row) => ({ cursor: positionOf(row), node: entryFor(row) }));
  const first = edges[0];
  const last = edges[edges.length - 1];

  return {
    edges,
    pageInfo: {
      // Null rather than absent when the page holds nothing: an empty page has
      // no ends, and a cursor invented for one would name a position nothing
      // occupies.
      startCursor: first?.cursor ?? null,
      endCursor: last?.cursor ?? null,
      hasNextPage: backward ? resumed : slice.more,
      hasPreviousPage: backward ? slice.more : resumed,
    },
    scope: { type: asEnum(view.context.type), id: view.context.id },
  };
}

/**
 * A stored row as a client sees it.
 *
 * @param row - The row, carrying whether this Viewer may read it.
 * @returns The entry. A row the Viewer may not read keeps its identifier, when
 *   it happened and what that claims, and loses everything else — the offset
 *   included.
 */
export function entryFor(row: TimelineReading): TimelineEntry {
  const occurredAt = instantOf(row.occurred_at);
  const occurrenceEnd = instantOf(row.occurrence_end);
  const occurrencePrecision = asEnum(row.occurrence_precision);

  if (row.readable === 0) {
    return { readable: false, momentId: row.moment_id, occurredAt, occurrenceEnd, occurrencePrecision };
  }

  return {
    readable: true,
    momentId: row.moment_id,
    occurredAt,
    occurrenceEnd,
    occurrencePrecision,
    occurrenceOffsetMinutes: row.occurrence_offset_minutes,
    visibility: asEnum(row.visibility),
    // ClickHouse has no boolean; `UInt8` is the idiom, and the conversion is
    // explicit so nobody has to remember which way round it went.
    discoverable: row.discoverable === 1,
  };
}

/**
 * The position a row occupies.
 *
 * @param row - The row.
 * @returns Its place in the sort tuple, which is what a cursor encodes.
 */
export function positionOf(row: TimelineReading): TimelinePosition {
  return { occurredAt: instantOf(row.occurred_at), momentId: row.moment_id };
}

/**
 * Read a stored datetime back as an instant.
 *
 * @param stored - `YYYY-MM-DD HH:MM:SS.mmm`, as ClickHouse returns it.
 * @returns The instant, read as UTC rather than as whatever zone this process
 *   happens to be set to. `DateTime64` has no zone: it stores what it was
 *   given, and it was given UTC.
 */
function instantOf(stored: string): Date {
  return new Date(`${stored.replace(" ", "T")}Z`);
}

/**
 * The schema's name for a value the contract writes in lowercase.
 *
 * @param value - The contract's value, as the projection stored it.
 * @returns The GraphQL enum value, which is the same word in the case GraphQL
 *   uses. A value from neither vocabulary fails as an invalid enum rather than
 *   being quietly presented as something it is not.
 */
function asEnum(value: string): string {
  return value.toUpperCase();
}
