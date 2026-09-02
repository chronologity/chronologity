import type { ErrorCode } from "@chronologity/contracts";
import { DomainError } from "./domain-error.js";

/**
 * A resource does not exist, or the requester may not know that it does.
 *
 * Authorization failures on resources whose existence is itself sensitive are
 * deliberately reported as not-found: a 403 confirms the resource exists.
 */
export class NotFoundError extends DomainError {
  override readonly code: ErrorCode = "NOT_FOUND";
  override readonly status = 404;
}
