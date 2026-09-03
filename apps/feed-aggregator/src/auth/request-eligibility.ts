import type {
  TimelineEligibility,
  TimelineEligibilityResolver,
  TimelineScopeRef,
  ViewerFacts,
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
  private facts: Promise<ViewerFacts> | undefined;

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
   * What is true of the Viewer, whatever they are reading.
   *
   * Its own memo rather than a scope's, because a Moment has no scope. Asking
   * `forScope` for one would resolve a Block list and a scope-bounded audience
   * that a PostgreSQL statement asks about itself, and would settle whether a
   * Timeline is open — which is a Timeline's question and has no business
   * gating a direct Moment read.
   *
   * Memoised for the same reason `forScope` is, and it is correctness rather
   * than cost: one response may read a Moment and the far ends of its
   * relationships, and a birthday falling between two of them would leave a
   * response whose parts disagreed about whether its reader was an adult.
   *
   * @returns The Viewer's identity and whether they are old enough for
   *   age-restricted history. The same object for the length of one request.
   * @throws {UnauthenticatedError} If the request offered no credential.
   *   Reading history requires an account (`moments.md:589`).
   * @throws {OnboardingRequiredError} If somebody is signed in but has not
   *   finished creating an account.
   */
  async forViewer(): Promise<ViewerFacts> {
    // Before the memo, so a refusal is never cached as anything.
    const userId = accountFor(this.viewer);

    if (this.facts !== undefined) {
      return this.facts;
    }

    const resolving = this.resolver.viewerFacts(userId);

    this.facts = resolving;

    try {
      return await resolving;
    } catch (error) {
      // A failed lookup is not an answer. Left behind it would be replayed to
      // every later reader in this request, turning one transient database
      // error into a whole response that could not be composed.
      this.facts = undefined;
      throw error;
    }
  }

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
