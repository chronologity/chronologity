/**
 * When an export is ready, when it stops being available, and what to do when
 * building one fails.
 *
 * Pure, so the arithmetic can be exercised without a database or an object
 * store. What lives here is deliberately narrow: an export's difficulty is not
 * in deciding these things but in shaping the data, which is
 * `export-document.ts` next door.
 */

/** What an export request may become. */
export type ExportState = "pending" | "ready" | "failed" | "abandoned" | "expired";

/** What a failed attempt may leave it as. Never `ready`, and never `expired`. */
export type ExportFailureState = Extract<ExportState, "pending" | "failed" | "abandoned">;

/** Whether trying again could help. */
export type ExportFailure = "transient" | "permanent";

/**
 * How many Moments go into one part.
 *
 * Bounded because a history is unbounded. `product/privacy.md:784` refuses to
 * cap the media in a Moment, which means it equally refuses to cap the Moments
 * in a history — so the export is many small files rather than one somebody
 * cannot download.
 */
export const DEFAULT_MOMENTS_PER_PART = 200;

/** How many days a prepared export remains available. */
export const DEFAULT_RETENTION_DAYS = 3;

/** How many attempts a transient failure is given. */
export const DEFAULT_MAXIMUM_ATTEMPTS = 5;

/** The first retry delay. Doubles with each attempt. */
export const DEFAULT_BACKOFF_MS = 30_000;

/** How long a retry is ever put off. */
const MAXIMUM_BACKOFF_MS = 60 * 60 * 1_000;

/** How long a claimed request is left alone before another worker may take it. */
export const DEFAULT_LEASE_MS = 10 * 60 * 1_000;

/**
 * How long a download link lives.
 *
 * Minutes, and generated when somebody asks rather than when the export was
 * built. `architecture/security.md:1776` requires short-lived download access,
 * and a URL signed at build time would still be valid days later — which is the
 * same as having no expiry at all for anybody who kept the manifest.
 */
export const DOWNLOAD_URL_TTL_SECONDS = 300;

/**
 * What one part of an export is called.
 *
 * @param index - Which part, counting from one.
 * @returns Its name. Zero-padded so that a hundred parts sort in the order they
 *   were written — an export listing part 10 before part 2 is one somebody
 *   reassembles wrongly.
 * @throws {RangeError} If the index is below one. Parts are counted from one
 *   because they are described to a person, and a manifest beginning at part
 *   zero reads as though something is missing.
 */
export function partName(index: number): string {
  if (index < 1) {
    throw new RangeError("Export parts are numbered from one");
  }

  return `moments-${String(index).padStart(4, "0")}.json`;
}

/**
 * How many parts a history of a given size needs.
 *
 * @param total - How many Moments there are.
 * @param perPart - How many go in each.
 * @returns The number of parts, never below one. An account with no Moments
 *   still gets an export — it has an account, comments, and relationships — and
 *   a manifest claiming zero parts would read as a failure rather than as an
 *   empty history.
 */
export function partsNeeded(total: number, perPart: number = DEFAULT_MOMENTS_PER_PART): number {
  return Math.max(1, Math.ceil(total / perPart));
}

/**
 * When a prepared export stops being available.
 *
 * @param at - When it was prepared.
 * @param days - How long it lives.
 * @returns The instant it expires, never before it was prepared.
 */
export function expiresAt(at: Date, days: number = DEFAULT_RETENTION_DAYS): Date {
  return new Date(at.getTime() + Math.max(0, days) * 24 * 60 * 60 * 1_000);
}

/**
 * Whether an export has run out.
 *
 * @param expires - When it expires, or undefined for one never prepared.
 * @param now - The instant to judge against.
 * @returns Whether it is past. An export exactly at its instant has expired:
 *   the boundary belongs to the side that withholds, because the thing being
 *   withheld is a copy of somebody's entire history.
 */
export function hasExpired(expires: Date | undefined, now: Date): boolean {
  return expires !== undefined && expires.getTime() <= now.getTime();
}

/**
 * What a failed attempt leaves the request as.
 *
 * @param failure - Whether trying again could help.
 * @param attempts - How many attempts have now failed, this one included.
 * @param maximumAttempts - How many are tolerated altogether.
 * @returns The state to record. Fewer attempts than erasure gets, deliberately:
 *   somebody is waiting for this, and an export that has failed five times is
 *   better reported than retried quietly for another hour.
 */
export function stateAfterFailure(
  failure: ExportFailure,
  attempts: number,
  maximumAttempts: number = DEFAULT_MAXIMUM_ATTEMPTS,
): ExportFailureState {
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
 *   earlier than `at`.
 */
export function retryAfter(
  at: Date,
  attempts: number,
  backoffMs: number = DEFAULT_BACKOFF_MS,
): Date {
  const delay = Math.min(backoffMs * 2 ** Math.max(0, attempts - 1), MAXIMUM_BACKOFF_MS);

  return new Date(at.getTime() + delay);
}

/**
 * Whether a failure is worth trying again.
 *
 * @param error - Whatever was thrown while building.
 * @returns `permanent` where trying again cannot help, and `transient`
 *   otherwise. Unrecognised failures are transient, which errs towards
 *   eventually producing the export rather than towards telling somebody their
 *   history could not be assembled.
 */
export function classifyFailure(error: unknown): ExportFailure {
  return error instanceof Error && error.name === "QueryFailedError"
    ? "permanent"
    : "transient";
}
