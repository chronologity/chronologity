import type { DataSource } from "typeorm";
import type { MomentCommentRepository } from "../../features/moments/moment-comment.repository.js";
import type { MomentRepository } from "../../features/moments/moment.repository.js";
import type { AccountErasureRepository } from "../../features/privacy/account-erasure.repository.js";
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
import type { StorageClient } from "../../integrations/storage/storage-client.js";
import { withTransaction } from "../../lib/database/transaction.js";
import { generateId } from "../../lib/ids/generate-id.js";
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
  readonly comments: MomentCommentRepository;
  readonly accounts: AccountErasureRepository;
  /** Used to remove what a prepared export left behind. */
  readonly storage: StorageClient;
  readonly uploads: UploadService;
  readonly documents: SearchRepository;
  /** Which index generation to remove documents from. */
  readonly indexVersion: string;
  readonly batchSize?: number;
  readonly maximumAttempts?: number;
  readonly backoffMs?: number;
  /** How long a claimed request is left alone before another worker may take it. */
  readonly leaseMs?: number;
  /**
   * How many of an account's Moments to hand to the Moment path per run.
   *
   * Bounded so that erasing a history of ten thousand Moments is many short
   * runs rather than one that holds a lease for an hour.
   */
  readonly momentsPerRun?: number;
  readonly now?: () => Date;
  readonly logger?: Logger;
}

export interface ErasureResult {
  readonly erased: number;
  /** Requests for subjects this deployment does not know how to erase. */
  readonly skipped: number;
  /** Requests that made progress and have more to do. */
  readonly continuing: number;
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
 * How many of an account's Moments one run hands onward.
 *
 * Small, because each becomes a request of its own and the point is to keep any
 * single run short rather than to finish quickly. A history of ten thousand
 * drains over many passes and holds no lease for long.
 */
const DEFAULT_MOMENTS_PER_RUN = 50;

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
    return {
      erased: 0,
      skipped: 0,
      continuing: 0,
      retrying: 0,
      failed: 0,
      abandoned: 0,
      reachedEnd: true,
    };
  }

  const tally = { erased: 0, skipped: 0, continuing: 0, retrying: 0, failed: 0, abandoned: 0 };

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
): Promise<"erased" | "skipped" | "continuing" | "retrying" | "failed" | "abandoned"> {
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
    if (kind === "account") {
      const finished = await eraseAccount(options, request.subjectId, at);

      if (!finished) {
        // Progress was made and more remains. Due again at once rather than
        // when the lease expires, and without touching the attempt count:
        // nothing failed, so counting this towards the ceiling would abandon
        // the erasure of a long history for being long.
        await withTransaction(options.dataSource, (tx) =>
          options.erasures.reschedule(tx, request.requestId, at),
        );

        return "continuing";
      }
    } else {
      await eraseMoment(options, request.subjectId);
    }

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
 * Erase what an account recorded, a bounded step at a time.
 *
 * A coordinator rather than one enormous unit of work. An account may hold ten
 * thousand Moments, and each one needs its media swept out of object storage —
 * so this hands them to the Moment path in batches and says whether there is
 * more to do. The Moment path is unchanged: a Moment belonging to a departing
 * account is erased exactly as one deleted on its own would be.
 *
 * The sweeps wait until every Moment has gone. That ordering matters for a
 * reason worth stating: a Moment still standing holds media, comments,
 * reactions and audience rows, and sweeping those tables first would race the
 * Moment path for the same rows and leave whichever lost with nothing to erase.
 *
 * @param options - Repositories and settings.
 * @param userId - Whose account.
 * @param at - The instant this pass began.
 * @returns Whether the account is finished. False means progress was made and
 *   the request should come round again.
 * @throws {Error} If a store refused, for the caller to classify and record.
 */
async function eraseAccount(
  options: ErasureOptions,
  userId: string,
  at: Date,
): Promise<boolean> {
  const perRun = options.momentsPerRun ?? DEFAULT_MOMENTS_PER_RUN;
  const pending = await options.accounts.nextMoments(userId, perRun);

  if (pending.length > 0) {
    for (const momentId of pending) {
      // The same two statements deleting a Moment performs, for the same
      // reason: what waits in the queue should be structure rather than
      // anybody's words. Nothing is announced — the Search document is removed
      // by the erasure itself, and there is nobody left to notify.
      await withTransaction(options.dataSource, async (tx) => {
        await options.moments.markDeleted(tx, momentId, at);
        await options.comments.blankAllForMoment(tx, momentId, at);
        await options.erasures.request(tx, {
          requestId: generateId(),
          subjectType: "moment",
          subjectId: momentId,
          at,
        });
      });
    }

    return false;
  }

  // Every Moment is gone. Anything still in object storage belonged to no
  // Moment — a file uploaded and never used, or one whose Moment has just been
  // erased — and nothing else will ever come for it.
  const orphans = await options.accounts.orphanedUploads(userId, perRun);

  for (const uploadId of orphans) {
    await options.uploads.erase(uploadId);
  }

  if (orphans.length === perRun) {
    // A full batch almost certainly means more. Come round again rather than
    // sweeping while uploads remain.
    return false;
  }

  // Before the sweep, because the sweep deletes the rows that say where these
  // are. A copy of somebody's whole history left in storage with nothing
  // pointing at it is worse than one nobody has got round to removing.
  for (const prefix of await options.accounts.exportPrefixes(userId)) {
    for (const key of await options.storage.list(prefix)) {
      await options.storage.remove(key);
    }
  }

  await withTransaction(options.dataSource, (tx) => options.accounts.sweep(tx, userId));

  return true;
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

