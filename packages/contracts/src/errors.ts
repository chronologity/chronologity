import { z } from "zod";

/**
 * Stable error classification.
 *
 * These codes are part of the boundary contract: they appear in API responses,
 * logs, metrics, and alerts, so renaming one is a breaking change. The set
 * below is the general classification documented in
 * `docs/architecture/observability.md` plus the transport-level codes any HTTP
 * boundary needs. Domain-specific codes — media processing, moderation — are
 * added by the phase that implements them.
 */
export const errorCodeSchema = z.enum([
  // Documented classification.
  "AUTHENTICATION_FAILED",
  "AUTHORIZATION_DENIED",
  "CONCURRENCY_CONFLICT",
  "PROVIDER_UNAVAILABLE",
  // Transport level.
  "VALIDATION_FAILED",
  // The caller is authenticated but has not finished account creation. A
  // distinct code because the client's response is specific: send them to
  // onboarding, not to sign in again.
  "ONBOARDING_REQUIRED",
  "NOT_FOUND",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

/**
 * The stable error envelope returned across the API boundary.
 *
 * `details` carries structured, client-safe context — which field failed
 * validation, for instance. Stack traces, SQL errors, event-store errors,
 * secrets, and raw provider failures must never reach it.
 */
export const errorResponseSchema = z.object({
  code: errorCodeSchema,
  message: z.string().min(1),
  traceId: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/**
 * Whether a caller can reasonably retry an operation that failed with this code.
 *
 * @param code - The error code returned.
 * @returns Whether trying the same operation again could reasonably succeed.
 */
export function isRetryable(code: ErrorCode): boolean {
  return (
    code === "CONCURRENCY_CONFLICT" || code === "PROVIDER_UNAVAILABLE" || code === "RATE_LIMITED"
  );
}
