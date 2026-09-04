import type { Position } from "../../pagination/cursors.js";
import type { ContextRow } from "../../read-models/clickhouse/context-axis-read-model.js";
import type { NamedContext } from "../../read-models/postgres/context-name-read-model.js";

/**
 * Rows and names as a stretch of the axis.
 *
 * Nothing decided here. Which contexts a reader may reach was settled inside the
 * statements, and which of those may be *named* was settled by the confirming
 * read; this arranges what survived into something a client can move through.
 */

/** Which tier of the axis a context sits in. */
export type Adjacency = "SHARED_HISTORY" | "SAME_PERIOD";

/** Somewhere else to stand, as a client receives it. */
export interface HistoricalContextShape {
  readonly scope: { readonly type: string; readonly id: string };
  readonly name: string;
  readonly adjacency: Adjacency;
}

/** One context in a page, at its position along the axis. */
export interface AxisEdge {
  readonly cursor: Position;
  readonly node: HistoricalContextShape;
}

/** A stretch of the axis. */
export interface AxisConnection {
  readonly edges: readonly AxisEdge[];
  readonly pageInfo: {
    startCursor: Position | null;
    endCursor: Position | null;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/**
 * Turn rows into contexts, dropping whatever could not be named.
 *
 * A candidate the confirming read did not return is dropped rather than named
 * emptily. For a place that means some Moment tying it here withheld where it
 * happened; for an occasion it means this reader may not know it exists. Either
 * way there is nothing honest to show, and a blank entry would itself say
 * something is there.
 *
 * @param rows - What the axis found, in the order it found them.
 * @param names - What each may be called, keyed `type:id`.
 * @param tier - Which tier these rows came from.
 * @returns The edges, in the order the rows arrived. The naming read answers in
 *   whatever order it likes, so the rows keep the ordering rather than the map.
 */
export function edgesFor(
  rows: readonly ContextRow[],
  names: ReadonlyMap<string, NamedContext>,
  tier: "shared" | "period",
): AxisEdge[] {
  const edges: AxisEdge[] = [];

  for (const row of rows) {
    const named = names.get(`${row.context_type}:${row.context_id}`);

    if (named === undefined) {
      continue;
    }

    edges.push({
      cursor: {
        kind: "context",
        tier,
        shared: row.shared_moments,
        latest: instantOf(row.latest),
        contextType: row.context_type,
        contextId: row.context_id,
      },
      node: {
        scope: { type: row.context_type.toUpperCase(), id: row.context_id },
        name: named.name,
        adjacency: tier === "shared" ? "SHARED_HISTORY" : "SAME_PERIOD",
      },
    });
  }

  return edges;
}

/**
 * Assemble a stretch of the axis.
 *
 * @param edges - Everything gathered, already in order and already trimmed.
 * @param more - Whether the axis continues past them.
 * @param resumed - Whether the request supplied a cursor.
 * @returns The connection.
 */
export function axisFor(edges: readonly AxisEdge[], more: boolean, resumed: boolean): AxisConnection {
  return {
    edges,
    pageInfo: {
      startCursor: edges[0]?.cursor ?? null,
      endCursor: edges[edges.length - 1]?.cursor ?? null,
      hasNextPage: more,
      hasPreviousPage: resumed,
    },
  };
}

/**
 * Read a stored datetime back as an instant.
 *
 * @param stored - `YYYY-MM-DD HH:MM:SS.mmm`, as ClickHouse returns it.
 * @returns The instant, read as UTC rather than as whatever zone this process
 *   happens to be set to.
 */
function instantOf(stored: string): Date {
  return new Date(`${stored.replace(" ", "T")}Z`);
}
