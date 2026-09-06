/**
 * Where this application can be, as types.
 *
 * Two separate maps rather than one, because the two halves are never reachable
 * from each other: somebody signed out cannot navigate to a Timeline, and the
 * root navigator swaps the whole tree rather than pushing between them. A single
 * map would type-check journeys that cannot happen.
 *
 * These are the bootstrap's routes, not the product's. The Timeline's real
 * navigation — vertical for time, horizontal for perspective, depth into a
 * Moment (`timeline.md:7-15`) — is Phase 12's, and `timeline.md:161` sets the
 * rule it has to meet: leaving depth returns you where you were.
 */

/** Screens available to somebody who is not signed in. */
export type AuthRoutes = {
  "sign-in": undefined;
};

/** Screens available to somebody who is. */
export type MainRoutes = {
  timeline: undefined;
  /** A Moment opened directly, including from a deep link. */
  moment: { momentId: string };
};
