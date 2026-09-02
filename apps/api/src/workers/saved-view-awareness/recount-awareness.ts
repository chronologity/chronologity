import { createHash } from "node:crypto";
import { viewSpecificationSchema } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { withTransaction } from "../../lib/database/transaction.js";
import { markFor } from "../../features/saved-views/saved-view-awareness.js";
import type { SavedViewRepository, StaleView } from "../../features/saved-views/saved-view.repository.js";
import type { NotificationGenerator } from "../../features/notifications/notification.generator.js";
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
  /**
   * Tells somebody a view they follow has grown.
   *
   * Optional: an application with no notifications still keeps its counts
   * correct, and the sweep's own job is the count rather than the telling.
   */
  readonly notify?: NotificationGenerator | undefined;
}

/**
 * The identifier under which one view's growth is announced.
 *
 * **Derived rather than random, and this is what makes the sweep safe to run
 * every minute.** The notification ledger is keyed on
 * `(source_event_id, recipient_user_id)`, so an identifier derived from the view
 * and the visit it is counted against means every pass over an unvisited window
 * presents the *same* event — recorded once and thereafter recognised as a
 * duplicate. Visiting moves the mark, which opens a new window and a new
 * identifier, so the next arrival is announced again.
 *
 * A random identifier would announce on every pass. A digest of the count would
 * announce again on every new Moment, which for a busy place is the same thing.
 *
 * @param savedViewId - Which view.
 * @param mark - The visit the count is relative to, or null before any visit.
 * @returns A stable UUID for this view and this unvisited window.
 */
export function announcementIdFor(savedViewId: string, mark: Date | null): string {
  const digest = createHash("sha256")
    .update(`saved-view-expanded:${savedViewId}:${mark === null ? "never" : mark.toISOString()}`)
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));

  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString("hex");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
  options: Pick<RecountOptions, "dataSource" | "savedViews" | "timeline" | "now" | "notify">,
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

  const recorded = await withTransaction(options.dataSource, (tx) =>
    options.savedViews.recordCount(
      tx,
      view.savedViewId,
      view.lastVisitedAt,
      capped ? COUNT_CEILING : counted,
      capped,
      now,
    ),
  );

  // Only when there is something to say, only if they asked to hear it, and only
  // if the count was actually recorded — a count superseded by a visit means
  // they have just looked, which is the one moment not to tell them.
  if (recorded && counted > 0 && view.followed && options.notify !== undefined) {
    await options.notify.consider(
      {
        type: "saved_view_expanded",
        // Nobody did this. History expanded, which is a different claim.
        actorUserId: undefined,
        subjectUserId: view.userId,
        sourceType: "saved_view",
        sourceId: view.savedViewId,
        // Deliberately absent. The Moment-visibility re-check exists for
        // notifications *about* a Moment; this one is about a view its owner
        // saved, and every Moment behind it was already counted under their own
        // eligibility. Naming one would also be the leak the wording avoids.
      },
      announcementIdFor(view.savedViewId, view.lastVisitedAt),
    );
  }

  return recorded;
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
