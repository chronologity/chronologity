/**
 * What an erasure request means, and what to do when one fails.
 *
 * Pure, so the decisions can be exercised over every combination without a
 * database. What is deliberately *not* here is the erasing: this file decides
 * which things may go and when to stop trying, and the worker performs it.
 *
 * The separation matters more here than in most features. Erasure is the one
 * operation this system performs that cannot be undone or re-run to correct a
 * mistake, so the rules that govern it should be readable in one place and
 * testable without arranging a database, an object store, and a Moment first.
 */

/** What kind of thing an erasure request concerns. */
export type ErasureSubject = "moment" | "account";

/** How an erasure attempt ended. */
export type ErasureFailure = "transient" | "permanent";

/** What a request may become. */
export type ErasureState = "pending" | "completed" | "failed" | "abandoned";

/**
 * What a request may become as a result of failing.
 *
 * Narrower than `ErasureState` by exactly one value, and the omission is the
 * point: a failed attempt can leave a request owed, refused, or given up on,
 * and it can never leave it complete.
 */
export type ErasureFailureState = Exclude<ErasureState, "completed">;

/**
 * How many attempts a transient failure is given.
 *
 * The outbox's number and the notification dispatcher's, for the same reason:
 * high enough that an object store unreachable for a while never reaches it,
 * low enough that a request which can never succeed stops being retried the
 * same day and becomes visible as a thing somebody must look at.
 */
export const DEFAULT_MAXIMUM_ATTEMPTS = 10;

/**
 * The first retry delay. Doubles with each attempt.
 *
 * Longer than the notification dispatcher's, and deliberately its own number
 * rather than a shared one. Nobody is waiting for an erasure the way somebody
 * waits for a message, and the failure it recovers from — an object store
 * refusing — takes longer to clear than a mail server refusing.
 */
export const DEFAULT_BACKOFF_MS = 60_000;

/** How long a retry is ever put off, however many attempts have failed. */
const MAXIMUM_BACKOFF_MS = 6 * 60 * 60 * 1_000;

/** How long a claimed request is left alone before another worker may take it. */
export const DEFAULT_LEASE_MS = 5 * 60 * 1_000;

/**
 * Whether this is a subject anything knows how to erase.
 *
 * @param subjectType - What the request names.
 * @returns The subject, or undefined for one this deployment cannot erase.
 *   Undefined rather than an error: the ledger is shared, it will gain further
 *   subjects, and a worker rolled out before the code that handles one should
 *   leave those requests alone rather than failing them. A request left pending
 *   can still be done; one marked failed needs somebody to notice.
 */
export function subjectKindOf(subjectType: string): ErasureSubject | undefined {
  return subjectType === "moment" || subjectType === "account" ? subjectType : undefined;
}

/**
 * Whether a failure is worth trying again.
 *
 * @param error - Whatever was thrown while erasing.
 * @returns `permanent` where trying again cannot help, and `transient`
 *   otherwise.
 *
 *   A constraint violation is the permanent case: something still references
 *   what erasure is trying to remove, which is a defect rather than a hiccup,
 *   and retrying it for ten hours before giving up only delays somebody seeing
 *   the real error.
 *
 *   Everything unrecognised is transient. That errs towards finishing an
 *   erasure late rather than abandoning it, and the attempt ceiling means an
 *   unrecognised permanent failure still stops — a few attempts later. Erring
 *   the other way would leave media in storage that somebody has been told is
 *   gone, which is the failure this whole path exists to prevent.
 */
export function classifyFailure(error: unknown): ErasureFailure {
  return error instanceof Error && error.name === "QueryFailedError"
    ? "permanent"
    : "transient";
}

/**
 * What a failed attempt leaves the request as.
 *
 * @param failure - Whether trying again could help.
 * @param attempts - How many attempts have now failed, this one included.
 * @param maximumAttempts - How many are tolerated altogether.
 * @returns The state to record. A permanent failure stops at once whatever the
 *   count, because a store that refused will refuse again; a transient one
 *   stays pending until the ceiling, past which it is abandoned rather than
 *   retried forever — a request retried forever is not retrying, it is a queue
 *   that never drains and a deletion nobody has been told is incomplete.
 */
export function stateAfterFailure(
  failure: ErasureFailure,
  attempts: number,
  maximumAttempts: number = DEFAULT_MAXIMUM_ATTEMPTS,
): ErasureFailureState {
  if (failure === "permanent") {
    return "failed";
  }

  return attempts >= maximumAttempts ? "abandoned" : "pending";
}

/**
 * When to try again.
 *
 * @param at - Now.
 * @param attempts - How many attempts have now failed.
 * @param backoffMs - The first delay.
 * @returns The next due time, doubling with each attempt and capped. Never
 *   earlier than `at`, including for an attempt count of zero, which cannot
 *   arise from a failure but can from a caller doing arithmetic.
 */
export function retryAfter(
  at: Date,
  attempts: number,
  backoffMs: number = DEFAULT_BACKOFF_MS,
): Date {
  const doublings = Math.max(0, attempts - 1);
  const delay = Math.min(backoffMs * 2 ** doublings, MAXIMUM_BACKOFF_MS);

  return new Date(at.getTime() + delay);
}

/**
 * Which of a Moment's uploads may actually be erased.
 *
 * The guard that keeps erasing one Moment from breaking another. Nothing
 * currently prevents attaching one upload to two Moments — the check on adding
 * media only looks within the same Moment — and whether that ought to be
 * possible is recorded in the ADRs as undecided. This does not decide it. It
 * only declines to destroy bytes something living still points at.
 *
 * @param attached - The uploads this Moment held.
 * @param stillInUse - Those a Moment that has not been deleted still references.
 * @returns The ones to erase, each once however often it was listed. An upload
 *   referenced only by other *deleted* Moments is erasable: those are awaiting
 *   erasure themselves, and whichever request runs last would otherwise leave
 *   the bytes behind for good.
 */
export function erasableUploads(
  attached: readonly string[],
  stillInUse: readonly string[],
): string[] {
  const keep = new Set(stillInUse);

  return [...new Set(attached)].filter((uploadId) => !keep.has(uploadId));
}
