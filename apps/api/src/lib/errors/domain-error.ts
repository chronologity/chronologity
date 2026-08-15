import type { ErrorCode } from "@chronologity/contracts";

/**
 * Base class for failures the API can describe to a client.
 *
 * Anything not derived from this is treated as an internal error at the
 * transport boundary, so an unexpected failure cannot leak its message.
 */
export abstract class DomainError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly status: number;
  /** Client-safe structured context. Never carries internals. */
  readonly details: Readonly<Record<string, unknown>> | undefined;

  /**
   * Build a domain error.
   *
   * @param message - Safe to show a client. Subclasses decide what that means
   *   for their case; the base class only guarantees it is deliberate.
   * @param details - Optional client-safe context, such as which field failed.
   */
  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}
