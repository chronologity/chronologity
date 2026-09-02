import type { ErrorCode } from "@chronologity/contracts";
import { DomainError } from "./domain-error.js";

/** The request was structurally invalid at a trust boundary. */
export class ValidationError extends DomainError {
  override readonly code: ErrorCode = "VALIDATION_FAILED";
  override readonly status = 400;
}
