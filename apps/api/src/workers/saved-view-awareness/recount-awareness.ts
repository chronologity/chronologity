import { viewSpecificationSchema } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { withTransaction } from "../../lib/database/transaction.js";
import { markFor } from "../../features/saved-views/saved-view-awareness.js";
import type { SavedViewRepository, StaleView } from "../../features/saved-views/saved-view.repository.js";
import type { TimelineService } from "../../features/timeline/timeline.service.js";

/**
 * Recounting what saved views have gained.
 *
 * Periodic rather than event-driven, and deliberately **not incremental**. A
 * counter that added one per arriving Moment could never see eligibility
 * *narrow* — a Moment going private, a moderation decision, a Block — so it
 * could only ever drift upward, which is the direction that discloses. Counting
 * afresh from the projection means every narrowing is picked up by the next
 * pass without anything having to notify anybody.
 */

/**
 * The ceiling on a single count.
 *
 * Past a hundred an exact figure is nothing anybody can act on, and the
 * counting query costs more the busier the view is. The presenter says "at
 * least" rather than pretending to precision.
 */
export const COUNT_CEILING = 100;

/** What one pass did. */
export interface RecountOutcome {
  /** How many views were recounted. */
  readonly recounted: number;
  /** How many were left as somebody had looked mid-count. */
  readonly superseded: number;
  /** Whether the batch was not filled, meaning there is nothing waiting. */
  readonly reachedEnd: boolean;
}

/** Everything one pass needs. */
export interface RecountOptions {
  readonly dataSource: DataSource;
  readonly savedViews: SavedViewRepository;
  readonly timeline: TimelineService;
  readonly batchSize: number;
  /** Injected so a test can pin what a rolling range resolves to. */
  readonly now?: () => Date;
}

/**
 * Recount one view.
 *
 * Exported separately from the batch so a test can drive one view without
 * sweeping, and so anything wanting an on-demand recount later has a way in.
 *
 * @param view - The view, as the queue read it.
 * @param options - Where to read and write.
 * @returns Whether the count was recorded. False means somebody visited while
 *   it was being counted and their zero stands, which is correct: they have
 *   just seen everything it would have said was new.
 * @throws {Error} If the stored specification cannot be read at all, which is a
 *   defect to notice rather than a view to quietly skip.
 */
export async function recountOne(
  view: StaleView,
  options: Pick<RecountOptions, "dataSource" | "savedViews" | "timeline" | "now">,
): Promise<boolean> {
  const now = (options.now ?? (() => new Date()))();
  const specification = viewSpecificationSchema.parse(view.specification);
  const since = markFor(view.createdAt, view.lastVisitedAt);

  const counted = await options.timeline.deriveNewCount(
    view.userId,
    specification,
    since,
    // One more than the ceiling, so reaching it is distinguishable from
    // stopping exactly on it.
    COUNT_CEILING + 1,
    now,
  );

  const capped = counted > COUNT_CEILING;

  return withTransaction(options.dataSource, (tx) =>
    options.savedViews.recordCount(
      tx,
      view.savedViewId,
      view.lastVisitedAt,
      capped ? COUNT_CEILING : counted,
      capped,
      now,
    ),
  );
}

/**
 * Recount a batch of the stalest views.
 *
 * @param options - Where to read and write, and how many at a time.
 * @returns What the pass did. `reachedEnd` is false while the batch fills,
 *   which is what tells the loop to come straight back rather than idle.
 * @throws {Error} If the database or the projection refuses. One view failing
 *   fails the pass: the loop will come round again, and a view whose count is
 *   never written simply stays at the head of the queue.
 */
export async function recountAwareness(options: RecountOptions): Promise<RecountOutcome> {
  const due = await options.savedViews.stalest(options.batchSize);
  let recounted = 0;
  let superseded = 0;

  for (const view of due) {
    if (await recountOne(view, options)) {
      recounted += 1;
    } else {
      superseded += 1;
    }
  }

  return { recounted, superseded, reachedEnd: due.length < options.batchSize };
}
