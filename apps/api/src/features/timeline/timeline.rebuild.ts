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
  /** Accounts the projection did not know were suspended, and now does. */
  readonly suspended: number;
  /** Accounts it was still withholding, whose suspension had been lifted. */
  readonly reinstated: number;
}

export interface TimelineRebuildOptions {
  /**
   * Rebuild exactly these Moments rather than walking every one.
   *
   * A scoped rebuild repairs rows; it does not restore the projection, so it
   * leaves the suspension dimension alone. Reconciling every account while
   * fixing one Moment would be work nobody asked for, and a surprise in a
   * command an operator reaches for when something is already wrong.
   */
  readonly only?: readonly string[];
  /** Called after each page, so a long rebuild can be watched. */
  readonly onProgress?: (done: number) => void;
  /**
   * How many Moments to read and write at once.
   *
   * Operational tuning, which `projections.md` names under rebuild throttling —
   * a bigger page is fewer round trips and a longer-held slice of both stores.
   * Also what lets a test drive a page boundary without inventing five hundred
   * Moments to reach one.
   */
  readonly pageSize?: number;
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
  // Taken before anything is read, not after. The suspension rows are ordered
  // by when the decision was taken and the newest wins, so a rebuild stamped at
  // the end could beat a `UserStatusChanged` that arrived while it ran — and
  // undo a reinstatement by restating what was true when it started. Stamped at
  // the start, anything that happens during the rebuild is newer and wins.
  const startedAt = new Date();

  let projected = 0;
  let removed = 0;
  let done = 0;

  const apply = async (momentIds: readonly string[]): Promise<void> => {
    // Through `projectBatch` rather than `handle`: a rebuild is not applying
    // messages, and recording an event identifier it never saw would leave a
    // processed-event row that means nothing.
    //
    // A page at a time rather than a Moment at a time. One Moment at a time
    // asked the projection "do you already hold this?" twice per Moment, and
    // because `moment_id` leads neither sort key each question was a full scan —
    // so the work grew with the square of the corpus and a rebuild of any size
    // eventually outlived the client's timeout rather than merely being slow.
    const tally = await projector.projectBatch(momentIds);

    projected += tally.projected;
    removed += tally.removed;
    done += momentIds.length;
    options.onProgress?.(done);
  };

  const page = options.pageSize ?? PAGE;

  // Named Moments, for an operator who knows which were affected and a test
  // that wants an assertion rather than a walk of every row in the database.
  if (options.only !== undefined) {
    for (let index = 0; index < options.only.length; index += page) {
      await apply(options.only.slice(index, index + page));
    }

    return { projected, removed, suspended: 0, reinstated: 0 };
  }

  // Paged by the same tuple the Timeline is ordered by, so a rebuild resumes
  // from where it stopped rather than starting again — and so it walks history
  // in the order history happened.
  let after: { occurredAt: Date; momentId: string } | undefined;

  for (;;) {
    const listed = await source.everyMoment(after, page);

    if (listed.length === 0) {
      return { projected, removed, ...(await reconcileSuspensions(projector, source, startedAt)) };
    }

    await apply(listed.map((entry) => entry.momentId));

    // Advanced from what the listing already returned. Reading the last Moment
    // again cost a round trip per page and, worse, ended the walk outright when
    // that one Moment had been erased since being listed — reporting success
    // having silently skipped the rest of history.
    const last = listed[listed.length - 1]!;

    after = { occurredAt: last.occurredAt, momentId: last.momentId };
  }
}

/**
 * Put the projection's idea of who is suspended back in step with the database.
 *
 * Part of a rebuild rather than a command of its own, because
 * `deployment.md:1292` requires a rebuild to preserve moderation and a rebuild
 * that restored every Moment while leaving this stale would hand back a
 * Timeline showing history somebody had withheld. A separable half is a half
 * that gets skipped.
 *
 * Reconciles in both directions. Only ever adding would leave an account
 * reinstated while the projection was down withheld for good, and there is no
 * event still coming to correct it — the decision has already been taken.
 *
 * Bounded by the number of suspended accounts rather than of Moments, which is
 * why the dimension is one row per account in the first place.
 *
 * Exported so it can be driven directly. Reaching it through a full rebuild
 * would mean walking every Moment in the database to assert something about
 * accounts, which is slow enough that the test would stop being run.
 *
 * @param projector - Writes the rows, the same one the worker uses.
 * @param source - Reads who is suspended now.
 * @param decidedAt - When the rebuild began, which orders its rows against any
 *   decision taken while it ran. Deliberately not the time of writing.
 * @returns How many accounts were newly withheld and how many released.
 * @throws {Error} If either store refuses.
 */
export async function reconcileSuspensions(
  projector: TimelineProjector,
  source: TimelineSourceRepository,
  decidedAt: Date,
): Promise<{ suspended: number; reinstated: number }> {
  const authoritative = new Set(await source.everySuspendedAuthor());
  const projected = new Set(await projector.suspendedAuthors());

  let suspended = 0;
  let reinstated = 0;

  for (const userId of authoritative) {
    if (!projected.has(userId)) {
      await projector.recordStatus(userId, "suspended", decidedAt);
      suspended += 1;
    }
  }

  for (const userId of projected) {
    if (!authoritative.has(userId)) {
      await projector.recordStatus(userId, "active", decidedAt);
      reinstated += 1;
    }
  }

  return { suspended, reinstated };
}
