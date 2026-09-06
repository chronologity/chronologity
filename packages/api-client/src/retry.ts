import { isRetryable } from "@chronologity/contracts";
import { ApiError } from "./api-error.js";

/**
 * What may be tried again, and when.
 *
 * **The server already decided which failures are worth retrying**, and this
 * uses that answer rather than inventing one: `isRetryable` in
 * `packages/contracts` names three codes — a concurrency conflict, a provider
 * that was unavailable, and a rate limit — and has been sitting there unused
 * since it was written. Everything else is a refusal that will be refused again.
 *
 * **A failure that never reached the server is a different thing entirely**, and
 * the client could not previously tell. A dropped connection throws a raw
 * `TypeError`; a timeout throws a `DOMException`. Neither is an `ApiError`, so
 * neither was classified, and both would have been reported to a caller as an
 * unrecognised crash. They are exactly the failures a retry exists for.
 *
 * **The hard rule is the method, not the error.** A `POST` that timed out may
 * have succeeded — the server recorded the Moment and the response was lost on
 * the way back — so retrying it records a second one. This system has no
 * idempotency keys (`api.md:1051` leaves the mechanism open), so there is
 * nothing to make a repeat safe. `GET`, `PUT` and `DELETE` may be repeated
 * because repeating them is defined to be the same as doing them once; `POST`
 * may not, unless a route documents itself idempotent and the caller says so.
 */

/** A request that never got an answer. */
export class TransportError extends Error {
  override readonly name = "TransportError";
  /** Whether trying again could plausibly work. */
  readonly retryable: boolean;

  /**
   * Build the error.
   *
   * @param message - What happened, in terms safe to show.
   * @param retryable - False when the caller cancelled, true otherwise. A
   *   caller who aborted does not want the request tried again on their behalf.
   * @param cause - What was actually thrown, kept for diagnosis.
   */
  constructor(message: string, retryable: boolean, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.retryable = retryable;
  }
}

/** How persistent to be. */
export interface RetryPolicy {
  /** Total attempts including the first. One means no retrying. */
  readonly attempts: number;
  /** The first backoff, doubled each attempt. */
  readonly baseDelayMs: number;
  /** The ceiling, so a long `Retry-After` does not strand a request forever. */
  readonly maxDelayMs: number;
}

/**
 * The policy a client gets if it asks for none.
 *
 * Three attempts, because the failures being retried are transient by
 * definition and a fourth attempt is usually a queue somebody should be told
 * about rather than waited on. `principles.md:1583` puts it plainly: "infinite
 * silent retries hide broken systems."
 */
export const defaultRetryPolicy: RetryPolicy = {
  attempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 5_000,
};

/** Methods whose repetition is defined to be the same as doing them once. */
const REPEATABLE = new Set(["GET", "HEAD", "PUT", "DELETE"]);

/**
 * Turn whatever `fetch` threw into something classified.
 *
 * @param error - What was thrown.
 * @param signal - The caller's own signal, so an abort they asked for is told
 *   apart from a timeout they did not.
 * @param timedOut - Whether this attempt's own deadline expired. Passed rather
 *   than inferred because the deadline is enforced with an `AbortController`
 *   rather than `AbortSignal.timeout`, which React Native does not have — and
 *   an ordinary abort carries no reason saying which clock ran out.
 * @returns A `TransportError`, or the error unchanged when it is already an
 *   `ApiError` — the server answered, and its answer is the classification.
 */
export function classify(
  error: unknown,
  signal: AbortSignal | undefined,
  timedOut = false,
): unknown {
  if (error instanceof ApiError) {
    return error;
  }

  // The caller cancelled. Retrying would be doing work they asked to stop.
  // Checked before the deadline, because a caller who aborts at the moment one
  // expires still asked to stop.
  if (signal?.aborted === true) {
    return new TransportError("The request was cancelled", false, error);
  }

  if (timedOut || (error instanceof DOMException && error.name === "TimeoutError")) {
    return new TransportError("The request timed out", true, error);
  }

  // `fetch` reports every network-level failure as a TypeError: no route to
  // host, connection reset, DNS failure, TLS refusal. None of them reached the
  // server, so none of them can have changed anything.
  if (error instanceof TypeError) {
    return new TransportError("The request could not be sent", true, error);
  }

  return error;
}

/**
 * Whether this failure, on this method, may be tried again.
 *
 * @param error - The classified failure.
 * @param method - The HTTP method attempted.
 * @param idempotent - Whether the caller declared this route safe to repeat,
 *   which is the only way a `POST` becomes retryable. `POST
 *   /uploads/:id/finalize` is documented as such; recording a Moment is not.
 * @returns Whether to try again.
 */
export function mayRetry(error: unknown, method: string, idempotent: boolean): boolean {
  if (!REPEATABLE.has(method) && !idempotent) {
    return false;
  }

  if (error instanceof TransportError) {
    return error.retryable;
  }

  return error instanceof ApiError && isRetryable(error.code);
}

/**
 * How long to wait before the next attempt.
 *
 * **The server's own answer wins where it gave one.** A 429 carries
 * `Retry-After`, and guessing shorter than it says is how a client turns a rate
 * limit into a longer one. The server deliberately withholds the
 * remaining-count header (ADR-150), so there is nothing else to read.
 *
 * Otherwise exponential, with jitter — because without it every client that
 * failed at the same moment retries at the same moment, which is the failure
 * mode a backoff exists to prevent.
 *
 * @param attempt - Which attempt just failed, counting from one.
 * @param retryAfterSeconds - What the response asked for, if anything.
 * @param policy - The bounds.
 * @returns Milliseconds to wait, never more than the policy's ceiling.
 */
export function delayFor(
  attempt: number,
  retryAfterSeconds: number | undefined,
  policy: RetryPolicy,
): number {
  if (retryAfterSeconds !== undefined) {
    return Math.min(retryAfterSeconds * 1000, policy.maxDelayMs);
  }

  const backoff = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);

  // Full jitter: anywhere between nothing and the backoff. Spreads a thundering
  // herd across the window rather than clustering it at the end.
  return Math.random() * backoff;
}

/**
 * What a response asked a client to wait.
 *
 * @param response - The failed response.
 * @returns Seconds, or undefined when the header is absent or is the HTTP-date
 *   form. The date form is legal and this API never sends it; parsing it would
 *   be code that could only ever be wrong in the field.
 */
export function retryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get("retry-after");

  if (header === null) {
    return undefined;
  }

  const seconds = Number(header);

  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}
