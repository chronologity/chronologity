import type { DataSource } from "typeorm";
import type { MomentRepository } from "../../features/moments/moment.repository.js";
import {
  classifyFailure,
  erasableUploads,
  retryAfter,
  stateAfterFailure,
  subjectKindOf,
  DEFAULT_BACKOFF_MS,
  DEFAULT_LEASE_MS,
  DEFAULT_MAXIMUM_ATTEMPTS,
} from "../../features/privacy/erasure.policy.js";
import type {
  ClaimedErasure,
  ErasureRepository,
} from "../../features/privacy/erasure.repository.js";
import type { SearchRepository } from "../../features/search/search.repository.js";
import type { UploadService } from "../../features/uploads/upload.service.js";
import { withTransaction } from "../../lib/database/transaction.js";
import type { Logger } from "../../lib/logger/logger.js";

/**
 * Finishing what deleting something started.
 *
 * Deleting a Moment marks it, blanks its caption, blanks the comments on it,
 * and returns. What is left afterwards is rows and bytes: the media in object
 * storage, the document in the Search index, and the row itself with everything
 * that hangs off it. This removes them.
 *
 * **It is a worker rather than part of the request for a product reason.** A
 * Moment may hold an unlimited number of images and videos, so erasing media
 * inline would do unbounded object-storage work inside an HTTP handler — and a
 * Moment with two hundred videos would time out half-erased with no record of
 * how far it got. `architecture/privacy.md:1136` separately requires
 * cross-store deletion to be retryable, idempotent, and observably complete,
 * which is this and the ledger behind it.
 *
 * **It removes derived artifacts itself rather than waiting for the indexer.**
 * That is what the roadmap's *restriction and deletion propagate at higher
 * priority than ordinary indexing* means in a system with one derived store:
 * the document goes in the same transaction as the row. The event-driven
 * indexer remains the backstop and converges on the same answer, so the two
 * cannot disagree — but erasure never queues behind a reindex.
 */

export interface ErasureOptions {
  readonly dataSource: DataSource;
  readonly erasures: ErasureRepository;
  readonly moments: MomentRepository;
  readonly uploads: UploadService;
  readonly documents: SearchRepository;
  /** Which index generation to remove documents from. */
  readonly indexVersion: string;
  readonly batchSize?: number;
  readonly maximumAttempts?: number;
  readonly backoffMs?: number;
  /** How long a claimed request is left alone before another worker may take it. */
  readonly leaseMs?: number;
  readonly now?: () => Date;
  readonly logger?: Logger;
}

export interface ErasureResult {
  readonly erased: number;
  /** Requests for subjects this deployment does not know how to erase. */
  readonly skipped: number;
  /** Failed this time, and still owed. Counted apart from the two that stop. */
  readonly retrying: number;
  /** Refused in a way that trying again cannot fix. */
  readonly failed: number;
  /** Given up on after the attempt ceiling. */
  readonly abandoned: number;
  /**
   * Whether everything due has been dealt with.
   *
   * Distinct from having erased nothing: a pass that filled its batch has
   * almost certainly left more behind and should run again at once.
   */
  readonly reachedEnd: boolean;
}

const DEFAULT_BATCH_SIZE = 20;

/**
 * Erase one batch of requests that have come due.
 *
 * @param options - Database, ledger, repositories, index version, batch size,
 *   attempt limit, backoff, lease, clock, and an optional logger.
 * @returns How many were erased, skipped, failed, and abandoned, and whether
 *   the ledger is now empty.
 * @throws {Error} If the database could not be reached while claiming. A
 *   failure while erasing one subject is recorded against its request and does
 *   not throw: the rest of the batch still runs, which is what
 *   `architecture/privacy.md:1149` means by a failure in one subsystem not
 *   silently stopping the workflow.
 */
export async function eraseDueRequests(options: ErasureOptions): Promise<ErasureResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const now = options.now ?? (() => new Date());
  const at = now();

  // Claimed and leased in its own short transaction, committed before any of
  // the slow work begins. A process that dies mid-erasure then leaves a request
  // that becomes due again rather than one stuck in a state nobody clears.
  const claimed = await withTransaction(options.dataSource, (tx) =>
    options.erasures.claimDue(tx, at, batchSize, options.leaseMs ?? DEFAULT_LEASE_MS),
  );

  if (claimed.length === 0) {
    return { erased: 0, skipped: 0, retrying: 0, failed: 0, abandoned: 0, reachedEnd: true };
  }

  const tally = { erased: 0, skipped: 0, retrying: 0, failed: 0, abandoned: 0 };

  for (const request of claimed) {
    tally[await eraseOne(options, request, at)] += 1;
  }

  return { ...tally, reachedEnd: claimed.length < batchSize };
}

/**
 * Erase one subject, and record what happened.
 *
 * @param options - Repositories and settings.
 * @param request - The claimed request.
 * @param at - The instant this pass began.
 * @returns What became of it.
 */
async function eraseOne(
  options: ErasureOptions,
  request: ClaimedErasure,
  at: Date,
): Promise<"erased" | "skipped" | "retrying" | "failed" | "abandoned"> {
  const kind = subjectKindOf(request.subjectType);

  if (kind === undefined) {
    // Left pending rather than failed. The ledger is shared, and a worker
    // rolled out before the code that handles a new subject should leave those
    // alone: a pending request can still be done, a failed one needs somebody
    // to notice. Its lease expires and a newer worker picks it up.
    options.logger?.debug(
      { requestId: request.requestId, subjectType: request.subjectType },
      "Nothing here knows how to erase that",
    );

    return "skipped";
  }

  try {
    await eraseMoment(options, request.subjectId);

    await withTransaction(options.dataSource, (tx) =>
      options.erasures.complete(tx, request.requestId, at),
    );

    return "erased";
  } catch (error) {
    const category = classifyFailure(error);
    const state = stateAfterFailure(
      category,
      request.attempts,
      options.maximumAttempts ?? DEFAULT_MAXIMUM_ATTEMPTS,
    );

    // Logged with the subject rather than its contents, which by this point are
    // partly gone anyway. The identifier is what somebody needs to find it.
    options.logger?.[state === "pending" ? "warn" : "error"](
      {
        requestId: request.requestId,
        subjectType: request.subjectType,
        subjectId: request.subjectId,
        attempts: request.attempts,
        category,
        err: error instanceof Error ? error.message : String(error),
      },
      state === "pending" ? "Erasure failed and will be retried" : "Erasure will not be retried",
    );

    await withTransaction(options.dataSource, (tx) =>
      options.erasures.recordFailure(tx, request.requestId, {
        state,
        category,
        error: error instanceof Error ? error.message : String(error),
        at,
        retryAt: retryAfter(at, request.attempts, options.backoffMs ?? DEFAULT_BACKOFF_MS),
      }),
    );

    // `pending` is not a failure this pass has finished with — the request is
    // still owed and will come round again. Counting it as failed would make an
    // object store having a bad minute look like data nobody erased.
    return state === "pending" ? "retrying" : state;
  }
}

/**
 * Erase one Moment.
 *
 * The order is deliberate and is what makes a partial run resumable. The row
 * goes last, so while anything remains undone the row is still there to say
 * what it was — its media links are the list of uploads to erase, and deleting
 * the row would take that list with it.
 *
 * @param options - Repositories and the index version.
 * @param momentId - Which Moment.
 * @returns Nothing.
 * @throws {Error} If a store refused. The caller records it against the request
 *   and tries again; whatever was already erased stays erased, because every
 *   step here is safe to repeat.
 */
async function eraseMoment(options: ErasureOptions, momentId: string): Promise<void> {
  // Read while the row is still there. Deleting it cascades the media links,
  // which are the only record of what this Moment held.
  const attached = await options.moments.findAttachedUploads(momentId);
  const stillInUse = await options.moments.uploadsStillInUse(attached);

  // Object storage first, and outside any transaction. A failure here leaves
  // objects nobody references, which is reclaimable; the reverse — a row gone
  // and bytes still served — is the failure this whole sub-phase exists to
  // prevent.
  for (const uploadId of erasableUploads(attached, stillInUse)) {
    await options.uploads.erase(uploadId);
  }

  await withTransaction(options.dataSource, async (tx) => {
    // Directly, rather than waiting for the indexer to notice. Deletion must
    // not queue behind a reindex.
    await options.documents.remove(tx, options.indexVersion, "moment", momentId);
    await options.moments.hardDelete(tx, momentId);
  });
}

