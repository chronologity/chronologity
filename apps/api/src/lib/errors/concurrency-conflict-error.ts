import type { ErrorCode } from "@chronologity/contracts";
import { DomainError } from "./domain-error.js";

/**
 * Raised when the state a decision was based on moved before it could be saved.
 *
 * An ordinary outcome under concurrency rather than a defect: two callers acted
 * on the same state and one of them must retry against fresh state. It maps to
 * a documented, retryable error code so a client can tell the difference
 * between "try again" and "this will never work".
 *
 * With PostgreSQL as the authority this is raised by a conditional update that
 * matched no rows — rotating a refresh credential that is no longer current, or
 * transitioning something that has already left the state it was expected to be
 * in. The guarantee comes from the `WHERE` clause rather than from a version
 * number the caller carries around (ADR-092).
 */
export class ConcurrencyConflictError extends DomainError {
  override readonly code: ErrorCode = "CONCURRENCY_CONFLICT";
  override readonly status = 409;
}
