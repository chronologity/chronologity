/**
 * Who is asking.
 *
 * Resolved once per request and passed explicitly from there. Never held in
 * process-global state: one person's authorization context sitting where
 * another request can reach it is the failure `feed.md:402` exists to forbid,
 * and in a service whose whole job is deciding what somebody may see, it would
 * be the worst possible one.
 *
 * A discriminated union rather than an object with nullable fields, so that
 * reading `userId` off an anonymous Viewer does not typecheck. Eligibility code
 * has to branch on this; making the branch structural means it cannot be
 * forgotten.
 */
export type Viewer = AnonymousViewer | AuthenticatedViewer;

/**
 * Somebody who has not said who they are.
 *
 * A real state rather than a failure — a request offering no credential resolves
 * to this, and is answered. It is simply a state that reads no history.
 *
 * `moments.md:589` settles that: "every read requires a Viewer, public Moments
 * included", because a Block is between two accounts and somebody who could
 * read signed out would have routed around one. So this Viewer can be told
 * whether it is signed in, and nothing else.
 *
 * An earlier version of this comment claimed the opposite — that public history
 * is readable without an account. It was wrong, and it sat directly above the
 * type everything downstream branches on.
 */
export interface AnonymousViewer {
  readonly kind: "anonymous";
}

/** Somebody whose token verified and whose Session is still open. */
export interface AuthenticatedViewer {
  readonly kind: "authenticated";
  /** The Identity, which exists from the moment somebody signs in. */
  readonly identityId: string;
  readonly sessionId: string;
  /**
   * The User, once account creation is complete.
   *
   * Absent for somebody authenticated who has not finished onboarding, which is
   * an ordinary state rather than an error. Taken from the token's claim only:
   * the API resolves it from the database when the claim is missing, and
   * whether a read service should do the same is a question about what an
   * unonboarded Viewer may see — which belongs with the eligibility rules
   * rather than with token parsing.
   */
  readonly userId: string | undefined;
}

/** The anonymous Viewer, which has no state and so needs only one instance. */
export const ANONYMOUS: AnonymousViewer = { kind: "anonymous" };
