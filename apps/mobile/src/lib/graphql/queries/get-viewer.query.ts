/**
 * Who the aggregator thinks is asking.
 *
 * **Not something the client already knows.** A Session identifier is not a
 * person: it names one sign-in on one device, and several may belong to the same
 * account. Scoping a Timeline needs the account, and the only honest source for
 * it is the service being asked — resolved from the credentials rather than from
 * anything the client asserts about itself, which is what the schema says of
 * this field outright.
 *
 * **`userId` is null for somebody signed in without an account yet.** That is
 * the `ONBOARDING_REQUIRED` state as the read surface expresses it (ADR-139),
 * and it is a different situation from being signed out: the credentials are
 * good, there is simply no history to scope to. A client that treated it as
 * signed-out would send somebody back to a sign-in screen they had just come
 * from.
 */
export const GET_VIEWER = `
  query GetViewer {
    viewer {
      authenticated
      userId
    }
  }
`;

/** What the aggregator says about the reader. */
export interface ViewerResult {
  readonly viewer: {
    readonly authenticated: boolean;
    /** Null when signed in but not yet onboarded. */
    readonly userId: string | null;
  };
}
