/**
 * How results are ordered.
 *
 * Versioned and deterministic. It produces the SQL that orders candidates
 * rather than scoring them in TypeScript afterwards, and that is deliberate:
 * ordering has to happen in the query for pagination to be correct, so scoring
 * in TypeScript would mean either fetching every eligible candidate — an
 * unbounded scan on request — or maintaining a second definition of relevance
 * that agrees with the first only until somebody edits one of them.
 *
 * **This module imports nothing.** Not a stylistic choice — the architecture
 * asks that engagement stay separable "so that a future optimization cannot
 * casually turn reaction or view counts into historical importance", and the
 * only durable form of that is being unable to reach one. A test asserts the
 * file has no imports at all, the same construction the significance scoring
 * uses.
 *
 * Ranking decides what somebody sees first. It says nothing about what mattered.
 */

/**
 * Which ranking produced an order.
 *
 * Carried in every cursor. A material relevance change ships as a new version
 * so it can be diagnosed, compared, and rolled back — and so anybody holding a
 * cursor from the old one is told rather than silently re-ranked mid-page.
 */
export const RANKING_VERSION = "ranking-v1";

/**
 * How much each signal is worth.
 *
 * Exported so the weights can be reasoned about and tested, and defined once so
 * the SQL below is the only thing that applies them.
 */
export const WEIGHT = {
  /** Orders several exact matches against each other; it does not create them. */
  exactTitle: 1_000,
  titlePrefix: 200,
  alias: 120,
  lexical: 40,
  temporal: 15,
  proximity: 15,
  /**
   * Bounded, and small enough to separate only candidates that are otherwise
   * close. `search.md:363` says significance participates as a tie-breaker and
   * never as a primary term — a weight large enough to promote a weak match
   * would make Search assert that something mattered.
   */
  significance: 5,
} as const;

/** What the caller must bind for the expression to work. */
export interface RankingParameters {
  /** The phrase, lowercased, or an empty string when only filters were given. */
  readonly phrase: string;
  readonly hasTemporalFilter: boolean;
  readonly hasProximityFilter: boolean;
}

/**
 * The SQL expression that scores a candidate.
 *
 * Exact matches do not reach first place through this. They arrive by their own
 * retrieval path, which `search.md:369` requires precisely so that navigational
 * priority does not depend on a weight being tuned until exact matches happen
 * to win; the exact-title weight here only orders several of them.
 *
 * @param alias - The alias the document table is joined under.
 * @param phraseParam - Which positional parameter carries the lowercased phrase.
 * @param queryParam - Which carries the words, for lexical rank. They are parsed
 *   here rather than by the caller, so nothing casts typed text to query syntax.
 * @param parameters - Which filters were asked for, since a satisfied filter
 *   contributes a little and an absent one contributes nothing.
 * @returns A SQL numeric expression. Comparable only against others from the
 *   same ranking version, and never returned to anybody.
 */
export function scoreExpression(
  alias: string,
  phraseParam: number,
  queryParam: number,
  parameters: RankingParameters,
): string {
  const phrase = parameters.phrase.length > 0;

  const parts = [
    // A title that is exactly the phrase, then one that begins with it.
    phrase
      ? `CASE WHEN lower(${alias}.title) = $${phraseParam} THEN ${WEIGHT.exactTitle}
              WHEN lower(${alias}.title) LIKE $${phraseParam} || '%' THEN ${WEIGHT.titlePrefix}
              ELSE 0 END`
      : "0",
    // A name it has also been known by. Not a nicety for historical Events.
    phrase
      ? `CASE WHEN lower(${alias}.aliases) LIKE '%' || $${phraseParam} || '%'
              THEN ${WEIGHT.alias} ELSE 0 END`
      : "0",
    // `plainto_tsquery`, not a cast: the parameter holds words somebody typed,
    // and casting those to `tsquery` asks Postgres to parse them as query
    // syntax — which fails on the first space.
    phrase
      ? `ts_rank(${alias}.search_vector, plainto_tsquery('simple', $${queryParam})) * ${WEIGHT.lexical}`
      : "0",
    // A filter that was asked for and is satisfied says the candidate is the
    // kind of thing wanted. Worth a little and never much: the filter has
    // already excluded everything that does not satisfy it.
    parameters.hasTemporalFilter
      ? `CASE WHEN ${alias}.occurrence_start IS NOT NULL THEN ${WEIGHT.temporal} ELSE 0 END`
      : "0",
    parameters.hasProximityFilter ? String(WEIGHT.proximity) : "0",
    // Capped, so a very significant Moment cannot outrank a better match.
    `LEAST(1.0, COALESCE(${alias}.significance, 0) / 100.0) * ${WEIGHT.significance}`,
  ];

  return `(${parts.join(" + ")})`;
}

/**
 * The ordering that follows a score.
 *
 * A total order, so the same question twice gives the same answer in the same
 * order. Score, then occurrence newest first, then identifier — the last is
 * arbitrary and that is the point: something has to settle a tie, and it must
 * be something that cannot change between two identical queries.
 *
 * @param alias - The alias the document table is joined under.
 * @param scored - The alias the computed score is selected as.
 * @returns A SQL ORDER BY body.
 */
export function relevanceOrder(alias: string, scored: string): string {
  return `${scored} DESC, ${alias}.occurrence_start DESC NULLS LAST, ${alias}.entity_id ASC`;
}

/**
 * The ordering for a chronological sort.
 *
 * Occurrence governs and relevance plays no part at all (`search.md:399`).
 *
 * @param alias - The alias the document table is joined under.
 * @param newestFirst - Which direction.
 * @returns A SQL ORDER BY body, ending in the identifier so the order is total
 *   and keyset paging has something to page on.
 */
export function occurrenceOrder(alias: string, newestFirst: boolean): string {
  const direction = newestFirst ? "DESC" : "ASC";

  return `${alias}.occurrence_start ${direction} NULLS LAST, ${alias}.entity_id ASC`;
}
