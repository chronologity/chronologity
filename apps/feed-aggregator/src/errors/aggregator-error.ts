import type { ErrorCode } from "@chronologity/contracts";

/**
 * Base class for failures this application can describe to a client.
 *
 * Anything not derived from this is treated as an internal error at the
 * boundary, so an unexpected failure cannot leak its message. That default
 * matters more here than in a command API: the things that go wrong in a read
 * service are ClickHouse errors and cursor-decoding errors, and both of them
 * describe storage in their message.
 *
 * The codes come from `packages/contracts`, so a client sees one vocabulary
 * across REST and GraphQL rather than learning a second one for reads.
 */
export abstract class AggregatorError extends Error {
  abstract readonly code: ErrorCode;
  /** The HTTP status this would carry, and what GraphQL reports alongside the code. */
  abstract readonly status: number;

  /**
   * Build an aggregator error.
   *
   * @param message - Safe to show a client. Subclasses decide what that means
   *   for their case; the base class only guarantees it is deliberate.
   */
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * The request did not establish who is asking.
 *
 * One error for every reason: an absent scheme, a bad signature, the wrong
 * issuer, an expired token, a Session that was revoked. Which of them it was is
 * not the caller's business, and saying would tell somebody probing which check
 * to fix next.
 *
 * Note what this is *not*: an unauthenticated request is not this error. A
 * request with no credentials at all is an anonymous Viewer, which is a state
 * the product supports. This is a request that tried to say who it was and
 * failed — and it fails closed rather than falling back to anonymous, so a
 * client with an expired token is told to refresh rather than quietly shown
 * less of somebody's history than it asked for.
 */
export class UnauthenticatedError extends AggregatorError {
  override readonly code = "AUTHENTICATION_FAILED" as const;
  override readonly status = 401;
}
