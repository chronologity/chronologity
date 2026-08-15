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

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}
