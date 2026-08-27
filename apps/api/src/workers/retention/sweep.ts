import type { RetentionRepository } from "../../features/privacy/retention.repository.js";
import {
  RETENTION_SCHEDULE,
  type RetentionPeriods,
} from "../../features/privacy/retention.policy.js";
import type { UploadService } from "../../features/uploads/upload.service.js";
import type { Logger } from "../../lib/logger/logger.js";

/**
 * Removing what has aged out.
 *
 * The counterpart to erasure. 5R-1 to 5R-3 removed what somebody asked to be
 * removed; this removes what nobody asks about — consumed sign-in links, spent
 * phone codes, delivery records, retired device tokens, audit events, and
 * uploads registered and never finished.
 *
 * **Nothing here touches history.** No Moment, comment, reaction, Location,
 * Event, or moderation record is in the schedule, and a test asserts it by
 * counting them across a sweep with every period set to zero. A product built
 * to preserve decades does not expire the decades.
 *
 * **A sweep is not a queue.** There is no lease, no attempt count, and no
 * per-row state, because a sweep that fails simply runs again on the next pass.
 * That is `sweepPublishedOutbox`'s shape rather than the erasure worker's, and
 * the difference is why this sub-phase needed no fifth implementation of
 * claim-lease-retry.
 */

export interface RetentionSweepOptions {
  readonly retention: RetentionRepository;
  /** Erases the objects behind an upload that was never finished. */
  readonly uploads: UploadService;
  readonly periods: RetentionPeriods;
  readonly batchSize?: number;
  readonly now?: () => Date;
  readonly logger?: Logger;
}

export interface RetentionSweepResult {
  /** How many rows each rule affected, by the rule's name. */
  readonly swept: Record<string, number>;
  /** Registrations that were never finished, and whose objects are now gone. */
  readonly uploadsErased: number;
  /**
   * Whether everything past its period has been dealt with.
   *
   * False when any rule filled its batch, which means there is more to remove
   * and the pass should run again rather than waiting out the interval.
   */
  readonly reachedEnd: boolean;
}

const DEFAULT_BATCH_SIZE = 500;

/**
 * How many expired registrations one pass erases.
 *
 * Far smaller than a row sweep, because each one talks to object storage.
 */
const UPLOAD_BATCH_SIZE = 25;

/**
 * Run every sweep once.
 *
 * @param options - Repository, uploads, periods, batch size, clock, and an
 *   optional logger.
 * @returns What each rule removed, how many registrations were erased, and
 *   whether anything remains.
 * @throws {Error} If the database could not be reached. A failure in one sweep
 *   stops that sweep; the rest of the pass still runs, because a table nobody
 *   can sweep should not stop every other table from being swept.
 */
export async function sweepRetained(
  options: RetentionSweepOptions,
): Promise<RetentionSweepResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const now = (options.now ?? (() => new Date()))();
  const swept: Record<string, number> = {};

  let reachedEnd = true;

  for (const rule of RETENTION_SCHEDULE) {
    try {
      const result = await options.retention.apply(rule, options.periods, batchSize, now);

      swept[rule.name] = result.removed;
      reachedEnd = reachedEnd && result.reachedEnd;
    } catch (error) {
      // Reported and stepped over. One table that cannot be swept — a lock held
      // by something long-running, a period misconfigured — must not stop every
      // other table from being swept, because the consequence of stopping is
      // data retained past its period with nothing saying so.
      options.logger?.error(
        { rule: rule.name, table: rule.table, err: describe(error) },
        "A retention sweep failed and was stepped over",
      );

      swept[rule.name] = 0;
      reachedEnd = false;
    }
  }

  const uploads = await eraseExpiredUploads(options, now);

  // A full batch of registrations almost certainly means more behind it. Left
  // out of `reachedEnd`, a backlog would drain twenty-five at a time once every
  // idle interval, which for a store of abandoned uploads is days.
  reachedEnd = reachedEnd && !uploads.filledBatch;

  try {
    const deleted = await options.retention.sweepDeletedUploads(
      now,
      options.periods.privacyRequests,
      batchSize,
    );

    swept["erased upload rows"] = deleted.removed;
    reachedEnd = reachedEnd && deleted.reachedEnd;
  } catch (error) {
    options.logger?.error(
      { rule: "erased upload rows", err: describe(error) },
      "A retention sweep failed and was stepped over",
    );

    reachedEnd = false;
  }

  return { swept, uploadsErased: uploads.erased, reachedEnd };
}

/**
 * Erase uploads that were registered and never finished.
 *
 * The one sweep that is not a delete: a registration has bytes behind it, or
 * part of them, and removing the row alone would leave those in storage with
 * nothing pointing at them.
 *
 * @param options - Repository and uploads.
 * @param now - The instant to measure against.
 * @returns How many were erased, and whether the batch was full — which tells
 *   the caller there is more behind it.
 */
async function eraseExpiredUploads(
  options: RetentionSweepOptions,
  now: Date,
): Promise<{ erased: number; filledBatch: boolean }> {
  const expired = await options.retention.expiredUploads(now, UPLOAD_BATCH_SIZE);
  let erased = 0;

  for (const upload of expired) {
    try {
      await options.uploads.erase(upload.uploadId);
      erased += 1;
    } catch (error) {
      // Left for the next pass. The registration stays expired and will be
      // found again; nothing here is owed to anybody waiting.
      options.logger?.warn(
        { uploadId: upload.uploadId, err: describe(error) },
        "An expired upload could not be erased and will be tried again",
      );
    }
  }

  return { erased, filledBatch: expired.length === UPLOAD_BATCH_SIZE };
}

/**
 * Describe a failure for a log line.
 *
 * @param error - Whatever was thrown.
 * @returns A short description.
 */
function describe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}
