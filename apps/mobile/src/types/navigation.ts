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

/**
 * The tabs somebody signed in moves between.
 *
 * One for now. The horizontal axis — the named Timelines a person reads across —
 * is 12H, and is not a tab bar.
 */
export type MainTabRoutes = {
  timeline: undefined;
};

/**
 * Screens available to somebody signed in.
 *
 * A stack with the tabs at its root, rather than a Moment being a hidden tab.
 * Opening a Moment is a push: it covers the tabs, it has somewhere to go back
 * to, and closing it returns to where the reader was — which
 * `timeline.md:161` requires of depth, that "Exiting should return the user to
 * the same meaningful chronological and contextual position".
 */
export type MainRoutes = {
  tabs: undefined;
  /** A Moment opened directly, including from a deep link. */
  moment: { momentId: string };
};
