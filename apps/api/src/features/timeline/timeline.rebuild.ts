import type { TimelineProjector } from "./timeline.projector.js";
import type { TimelineSourceRepository } from "./timeline-source.repository.js";

/**
 * Rebuilding the Timeline from authoritative state.
 *
 * ClickHouse holds nothing that cannot be reconstructed from PostgreSQL, and
 * this is the thing that makes that claim true rather than aspirational. It is
 * what recovers from a projection lost, a worker that was wrong for a week, and
 * a column added to the row.
 *
 * **It reads the database, never the event log**, which is the same choice the
 * Search rebuild makes and matters most for a reason unrelated to convenience:
 * a Moment somebody erased is absent from PostgreSQL, so a rebuild cannot bring
 * it back. Replaying events would resurrect exactly what erasure removed, and
 * `privacy.md` requires that it does not.
 *
 * A rebuild writes through the same projector the worker uses. Two paths that
 * built rows differently would eventually disagree, and the disagreement would
 * show up as a Timeline that changed when somebody rebuilt it.
 */

/** How many Moments to read at a time. */
const PAGE = 500;

export interface TimelineRebuildReport {
  /** Moments given a row. */
  readonly projected: number;
  /** Moments the Timeline must not hold, whose rows were removed if present. */
  readonly removed: number;
}

export interface TimelineRebuildOptions {
  /** Rebuild exactly these Moments rather than walking every one. */
  readonly only?: readonly string[];
  /** Called after each page, so a long rebuild can be watched. */
  readonly onProgress?: (done: number) => void;
}

/**
 * Rebuild the Timeline.
 *
 * @param projector - Writes the rows, the same one the worker uses.
 * @param source - Reads which Moments exist.
 * @param options - A subset to rebuild, and a progress callback.
 * @returns How many Moments were projected and how many removed.
 * @throws {Error} If either store refuses. A rebuild that stopped partway has
 *   written every row it reached: the projection is a mixture of versions
 *   rather than corrupt, and running it again finishes the job.
 */
export async function rebuildTimeline(
  projector: TimelineProjector,
  source: TimelineSourceRepository,
  options: TimelineRebuildOptions = {},
): Promise<TimelineRebuildReport> {
  let projected = 0;
  let removed = 0;
  let done = 0;

  const apply = async (momentIds: readonly string[]): Promise<void> => {
    for (const momentId of momentIds) {
      // Through `project` rather than `handle`: a rebuild is not applying
      // messages, and recording an event identifier it never saw would leave a
      // processed-event row that means nothing.
      const outcome = await projector.project(momentId);

      if (outcome === "projected") {
        projected += 1;
      } else {
        removed += 1;
      }
    }

    done += momentIds.length;
    options.onProgress?.(done);
  };

  // Named Moments, for an operator who knows which were affected and a test
  // that wants an assertion rather than a walk of every row in the database.
  if (options.only !== undefined) {
    for (let index = 0; index < options.only.length; index += PAGE) {
      await apply(options.only.slice(index, index + PAGE));
    }

    return { projected, removed };
  }

  // Paged by the same tuple the Timeline is ordered by, so a rebuild resumes
  // from where it stopped rather than starting again — and so it walks history
  // in the order history happened.
  let after: { occurredAt: Date; momentId: string } | undefined;

  for (;;) {
    const page = await source.everyMoment(after, PAGE);

    if (page.length === 0) {
      return { projected, removed };
    }

    await apply(page);

    const last = await source.momentFor(page[page.length - 1]!);

    if (last === undefined) {
      // Erased between being listed and being read. Ordinary rather than
      // exceptional, and there is nothing left to resume from — so the walk
      // stops rather than looping on a cursor it cannot advance.
      return { projected, removed };
    }

    after = { occurredAt: last.occurrenceStart, momentId: last.momentId };
  }
}
