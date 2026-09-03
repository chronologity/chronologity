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
 * It also refuses a request that offered nothing and then asked for history.
 * Establishing a Viewer and being entitled to read are different questions: a
 * request with no credentials resolves to an anonymous Viewer, which is a real
 * state, and that Viewer may read nothing. `moments.md:589` requires it —
 * "every read requires a Viewer, public Moments included" — because a Block is
 * between two accounts, so a blocked person who could read signed out would
 * have routed around it.
 *
 * Failing closed rather than falling back to anonymous matters for the other
 * case too: a client with an expired token is told to refresh rather than
 * quietly shown less of somebody's history than it asked for.
 */
export class UnauthenticatedError extends AggregatorError {
  override readonly code = "AUTHENTICATION_FAILED" as const;
  override readonly status = 401;
}

/**
 * The request is signed in, but there is no account behind it yet.
 *
 * A Session exists from the moment somebody signs in; a User exists once they
 * finish creating an account. Between the two there is nobody for eligibility
 * to be resolved for — no Blocks, no audience, no recorded age — so history is
 * refused.
 *
 * Its own code rather than an authentication failure, and that distinction is
 * the whole point. Telling this person they are not authenticated would send
 * them to sign in, which they have already done; telling them onboarding is
 * unfinished sends them where the problem actually is. `apps/api` draws the
 * same line with the same code, so a client handles one answer rather than two.
 */
export class OnboardingRequiredError extends AggregatorError {
  override readonly code = "ONBOARDING_REQUIRED" as const;
  override readonly status = 403;
}

/**
 * The request is well-formed GraphQL and is not a question this service can ask.
 *
 * GraphQL refuses an unknown field, a wrong type and a missing argument before a
 * resolver runs, and everything it refuses is refused better than this could be.
 * What is left are the combinations the schema cannot express: a lens only a
 * person has, asked of a place; a filter naming the same kind of thing the view
 * is already about; both ends of a page asked for at once.
 *
 * Its message is written to be shown. Each of these is somebody's client sending
 * a combination that does not mean anything, and the useful answer says which.
 */
export class ValidationError extends AggregatorError {
  override readonly code = "VALIDATION_FAILED" as const;
  override readonly status = 400;
}
