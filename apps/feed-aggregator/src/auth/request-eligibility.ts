import type {
  TimelineEligibility,
  TimelineEligibilityResolver,
  TimelineScopeRef,
} from "@chronologity/timeline-derivation";
import type { Viewer } from "./auth-context.js";
import { accountFor } from "./require-account.js";

/**
 * What the Viewer may see, resolved once per scope for the length of a request.
 *
 * Built per request and thrown away with it. Never shared between requests:
 * one person's authorization context sitting where another request can reach it
 * is the failure `feed.md:402` exists to forbid, and in a service whose whole
 * job is deciding what somebody may see it would be the worst available bug.
 *
 * **Memoised because two resolutions could disagree**, not because three
 * queries are expensive. One GraphQL response may compose several reads of the
 * same scope, and somebody could be blocked between two of them — leaving a
 * response whose parts disagreed about what its reader was entitled to. The API
 * already resolves once for both halves of a jump for exactly this reason
 * (`timeline.service.ts:281`). A request that reads a scope twice gets one
 * answer, and it is the answer the request began with.
 *
 * This is not the batching of 9H. It is a memo over one function, kept for a
 * request, and it is here because correctness wants it.
 */
export class RequestEligibility {
  private readonly resolved = new Map<string, Promise<TimelineEligibility>>();

  /**
   * Build the request's eligibility.
   *
   * @param resolver - The shared resolver, reading current state from
   *   PostgreSQL.
   * @param viewer - Who this request established.
   */
  constructor(
    private readonly resolver: TimelineEligibilityResolver,
    private readonly viewer: Viewer,
  ) {}

  /**
   * What this Viewer may see within one scope.
   *
   * @param scope - Whose history, or which place or occasion, is being read.
   * @returns The facts the Timeline query filters by. The same object for the
   *   same scope within one request.
   * @throws {UnauthenticatedError} If the request offered no credential.
   *   Reading history requires an account (`moments.md:589`).
   * @throws {OnboardingRequiredError} If somebody is signed in but has not
   *   finished creating an account.
   */
  async forScope(scope: TimelineScopeRef): Promise<TimelineEligibility> {
    // Before the memo, so a refusal is never cached as anything: throwing here
    // leaves the map untouched, and the next call refuses identically rather
    // than reading back a rejected promise.
    const userId = accountFor(this.viewer);
    const key = `${scope.type}:${scope.id}`;
    const already = this.resolved.get(key);

    if (already !== undefined) {
      return already;
    }

    // Stored before it settles, so two resolvers asking at once share one
    // round trip rather than racing to start a second.
    const resolving = this.resolver.resolve(userId, scope);

    this.resolved.set(key, resolving);

    try {
      return await resolving;
    } catch (error) {
      // A failed lookup is not an answer. Left in the map it would be replayed
      // to every later reader of this scope, turning one transient database
      // error into a whole response that could not be composed.
      this.resolved.delete(key);
      throw error;
    }
  }
}
