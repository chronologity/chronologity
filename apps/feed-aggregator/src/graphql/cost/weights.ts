/**
 * What each part of a document costs to answer.
 *
 * **The unit is a database statement**, because that is what this service
 * actually spends. Not fields, which say nothing about work — a caption and a
 * discussion are one field each and one of them is free. Not rows, which the
 * page bounds already govern. Statements, which the existing statement-count
 * suites already assert and which `aggregator-read-baseline.json` already
 * records per scenario.
 *
 * **Every weight below was measured rather than chosen.** ADR-136 declined to
 * set a budget because "a budget defended against a two-type schema would be a
 * number nobody could defend", and ADR-141 deferred it again for the same
 * reason. Both were right at the time and neither is now: the schema is complete
 * and 9I measured it.
 *
 * The two facts that shape the table, and both are surprising:
 *
 * **Naming the same root field many times is nearly free**, because 9H's loader
 * batches it. Ten aliased `moment(id:)` selections cost one statement, which the
 * batched-statement-count suite asserts directly. A cost model charging per
 * alias would refuse documents that cost nothing.
 *
 * **Asking those Moments for their contents is not free**, and that asymmetry is
 * the whole reason a budget is needed. ADR-146 recorded it deliberately: "Ten
 * Moments asked for their media is ten statements… what bounds that is a limit
 * on how much one document may ask for — 9K's, not a loader's."
 */

/**
 * Root fields, charged once however many times they are named.
 *
 * Batched or single-shot: naming one twice costs what naming it once costs, so
 * the second selection adds nothing. A cost model that charged per alias here
 * would be describing a service other than this one.
 */
export const BATCHED_ROOTS: Readonly<Record<string, number>> = {
  // One session lookup, already paid by the request.
  viewer: 0,
  // The Moment loader answers every alias in one statement (ADR-146).
  moment: 1,
  realWorldEvent: 1,
};

/**
 * Root fields, charged per selection.
 *
 * Each reads its own page, and two of them read two. Nothing batches these:
 * asking for two Timelines is two ClickHouse reads however they are aliased.
 */
export const PER_SELECTION_ROOTS: Readonly<Record<string, number>> = {
  timeline: 1,
  timelineHead: 1,
  temporalDistribution: 1,
  // Two pages, either side of the landing.
  timelineAround: 2,
  // The first page reaches tier two, which is the expensive one.
  adjacentContexts: 2,
};

/**
 * Fields on a Moment, charged per Moment they are asked of.
 *
 * The N in the multiplication. `depth-statement-count.integration.test.ts`
 * measures each of these as exactly one statement, and measures that it stays
 * one against ten times the data — so the cost grows with how many Moments a
 * document names, and not at all with how much history each holds.
 */
export const MOMENT_FIELDS: Readonly<Record<string, number>> = {
  media: 1,
  comments: 1,
  reactions: 1,
  relationships: 1,
};

/**
 * What counting a discussion adds.
 *
 * Its own entry because it is a field on the connection rather than on the
 * Moment, and because it is the read 9I found scanning the whole comment table.
 * It is indexed now and still a statement.
 */
export const COMMENT_TOTAL = 1;

/**
 * The default ceiling, in statements.
 *
 * Chosen against the measurements rather than picked: a Timeline page costs 1,
 * the fullest possible reading of one Moment costs 5, and the heaviest thing a
 * client has any reason to send — a page plus twenty Moments opened in full — is
 * a little over a hundred. So a hundred admits every document this product has a
 * use for and refuses the shapes it does not: two hundred aliased Moments each
 * asking for everything costs a thousand.
 *
 * **It is a ceiling on one document, never a rate.** How often somebody may send
 * a hundred-statement document is a different question with a different answer,
 * and conflating them produces a limit that is either too tight for one request
 * or too loose for a thousand.
 */
export const DEFAULT_MAX_COST = 100;
