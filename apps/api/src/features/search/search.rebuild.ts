import type { SearchIndexer } from "./search.indexer.js";
import type { SearchSourceRepository } from "./search-source.repository.js";
import type { SearchEntityType } from "./search-document.js";

/** Where each entity type's identifiers come from. */
const SOURCES: readonly { entityType: SearchEntityType; table: string; idColumn: string }[] = [
  { entityType: "moment", table: "moments", idColumn: "moment_id" },
  { entityType: "user", table: "users", idColumn: "user_id" },
  { entityType: "event", table: "real_world_events", idColumn: "real_world_event_id" },
  { entityType: "location", table: "locations", idColumn: "location_id" },
];

/** How many identifiers to take at a time. */
const PAGE = 500;

/** How to run a rebuild. */
export interface RebuildOptions {
  /** Called after each page, so a long rebuild is observable rather than silent. */
  readonly onProgress?: (entityType: SearchEntityType, done: number) => void;
  /**
   * Reindex only these entities, by type.
   *
   * Omitted for a full rebuild, which walks every table. A full rebuild is
   * tens of thousands of entities and is measured in minutes; naming what
   * needs redoing is what makes a targeted fix cheap.
   */
  readonly only?: Partial<Record<SearchEntityType, readonly string[]>>;
}

/** What a rebuild did. */
export interface RebuildReport {
  readonly written: number;
  readonly removed: number;
  readonly superseded: number;
  readonly byType: Record<string, number>;
}

/**
 * Build an index version from authoritative state.
 *
 * This is how a version is created and how a defective one is replaced. It is
 * not a Kafka replay: because documents are built by reading authoritative
 * state, walking the tables produces exactly what replaying every event would,
 * and does not depend on the broker having retained messages since the platform
 * started.
 *
 * It calls the same indexer the worker calls. A rebuild that used its own
 * builder would only prove the two agreed on the day somebody last compared
 * them.
 *
 * Safe to run while the worker runs. Paging is on the identifier rather than an
 * offset, so a set shifting underneath cannot make it skip a row, and the
 * regression guard means a rebuild's older reading never overwrites a document
 * the worker has since made newer.
 *
 * @param indexer - Writes the documents, targeting whichever version it was
 *   built for.
 * @param sources - Where the identifiers are read from.
 * @param options - Progress reporting, and optionally the entities to limit
 *   the rebuild to.
 * @returns What it did, per entity type and in total.
 */
export async function rebuildSearchIndex(
  indexer: SearchIndexer,
  sources: SearchSourceRepository,
  options: RebuildOptions = {},
): Promise<RebuildReport> {
  const { onProgress, only } = options;
  let written = 0;
  let removed = 0;
  let superseded = 0;
  const byType: Record<string, number> = {};

  for (const source of SOURCES) {
    let done = 0;

    // Scoped mode: reindex exactly the entities named. What an operator wants
    // after fixing a defect that affected a known set, and what lets a test
    // assert the rebuild's output without walking every row in the database.
    //
    // "Only these" means only these. A type absent from the scope is skipped
    // rather than fully rebuilt — the first version fell through to the full
    // walk for every unlisted type, which quietly turned a request to reindex
    // one Moment into a rebuild of every account on the platform.
    const scoped = only === undefined ? undefined : (only[source.entityType] ?? []);

    if (scoped !== undefined) {
      for (let i = 0; i < scoped.length; i += PAGE) {
        const tally = await indexer.indexBatch(source.entityType, scoped.slice(i, i + PAGE));

        written += tally.written;
        removed += tally.removed;
        superseded += tally.superseded;
        done += Math.min(PAGE, scoped.length - i);
      }

      byType[source.entityType] = done;
      onProgress?.(source.entityType, done);
      continue;
    }

    let after: string | undefined;

    for (;;) {
      const ids = await sources.idsAfter(source.table, source.idColumn, after, PAGE);

      if (ids.length === 0) {
        break;
      }

      const tally = await indexer.indexBatch(source.entityType, ids);

      written += tally.written;
      removed += tally.removed;
      superseded += tally.superseded;
      done += ids.length;

      after = ids[ids.length - 1];
      onProgress?.(source.entityType, done);
    }

    byType[source.entityType] = done;
  }

  return { written, removed, superseded, byType };
}
