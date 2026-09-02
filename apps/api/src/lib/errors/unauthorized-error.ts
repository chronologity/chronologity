import type { ErrorCode } from "@chronologity/contracts";
import { DomainError } from "./domain-error.js";

/** The request carried no usable identity. Distinct from being denied one. */
export class UnauthenticatedError extends DomainError {
  override readonly code: ErrorCode = "AUTHENTICATION_FAILED";
  override readonly status = 401;
}

/**
 * The identity is known but not permitted.
 *
 * Authentication and authorization are separate concerns (ADR-033), so they
 * are separate errors rather than one class with a flag.
 */
export class UnauthorizedError extends DomainError {
  override readonly code: ErrorCode = "AUTHORIZATION_DENIED";
  override readonly status = 403;
}
