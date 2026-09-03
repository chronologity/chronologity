/**
 * What a Viewer may be shown of a Moment.
 *
 * Two applications read Moments from the same PostgreSQL tables: the API, which
 * serves REST and owns every write, and the feed aggregator, which composes
 * Moment depth for the client. They may not import each other, so what they must
 * agree about lives here.
 *
 * **This package computes and never connects**, exactly as its Timeline sibling
 * does. It holds SQL text and pure functions; it takes no client, opens no
 * socket and issues no query. Each application supplies its own connection and
 * runs what this returns — which is what lets one rule serve a query builder
 * that binds by name and a driver that binds by position.
 *
 * It is deliberately *not* neutral between datastores. These are PostgreSQL
 * predicates over the authoritative tables, and pretending otherwise would buy
 * an abstraction nobody needs. Its sibling `@chronologity/timeline-derivation`
 * holds the equivalent rule in ClickHouse over the Timeline projection; the two
 * are separate packages because they are separate statements over separate
 * stores, and folding them together would put a name on something that is not
 * one thing.
 *
 * What is here is what must not exist twice:
 *
 * - **whether a Moment may be read**, in two halves that are asked separately
 *   in one place — privacy omits a relationship's far end entirely while
 *   moderation leaves a tombstone, and a reader that conflated them would
 *   announce that somebody's private history exists;
 * - **whether a comment may be read**, which is a different question about a
 *   different person and asks nothing about age;
 * - **how much of a place a reader is told**, because a privacy reduction
 *   written twice is a privacy reduction that will be widened in one copy.
 *
 * What is not here is either application's own queries. A rule is what they must
 * agree about; a statement is each one's own business.
 */
export { commentReadableBy } from "./comment-access.js";

export { moderationPermits, privacyPermits, visibleToViewer } from "./moment-access.js";

export {
  NAMED_VIEWER,
  PositionalParameters,
  type ViewerPlaceholders,
} from "./placeholders.js";

export { disclosePlace } from "./place-disclosure.js";
