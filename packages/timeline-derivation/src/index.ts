/**
 * How a View Specification becomes a Timeline read.
 *
 * Two applications derive Timelines from the same ClickHouse projection: the
 * API, which serves REST and counts what a Saved View has gained, and the feed
 * aggregator, which composes GraphQL for the client. They may not import each
 * other, so what they must agree about lives here.
 *
 * **This package computes and never connects.** It holds SQL text and pure
 * functions; it takes no client, opens no socket and issues no query. Each
 * application supplies its own connection and runs what this returns. That is
 * what makes it neutral between the two — and it is deliberately not neutral
 * between datastores, because the projection is ClickHouse and pretending
 * otherwise would buy an abstraction nobody needs.
 *
 * What is here is what must not exist twice:
 *
 * - **the eligibility rule**, because a security rule written in two places
 *   eventually disagrees with itself, and this is the one that leaks when it
 *   does;
 * - **the cursor format**, together with the keyset condition and ordering that
 *   read it back, because two implementations that drift would silently skip
 *   and repeat Moments that share an occurrence time;
 * - **the translation from a specification to filters**, so that a Saved View
 *   means the same thing whichever application opens it;
 * - **the row shape and the projection version**, so both read the same columns
 *   of the same version.
 *
 * What is not here is each application's own query methods. Their needs
 * genuinely differ — the API returns REST pages and counts what a Saved View
 * has gained, the aggregator builds GraphQL connections — and sharing the
 * execution layer would force one shape on both.
 */
export {
  boundaryCondition,
  CursorError,
  decodeCursor,
  encodeCursor,
  orderFor,
  type TimelineDirection,
  type TimelinePosition,
} from "./cursor.js";

export {
  eligible,
  TimelineEligibilityResolver,
  type Queryable,
  type TimelineEligibility,
  type TimelineScopeRef,
  type TimelineScopeType,
  type ViewerFacts,
} from "./eligibility.js";

export { narrowingFor, narrowingSql, resolveRange, type ViewNarrowing } from "./narrowing.js";

export {
  asClickHouseDateTime,
  TIMELINE_VERSION,
  toRecord,
  type TimelineReading,
  type TimelineRecord,
  type TimelineRow,
} from "./row.js";
