/**
 * What Discovery offers first.
 *
 * **This module imports nothing.** Not a stylistic choice — `discovery.md:532`
 * warns that engagement must not dominate Discovery and `discovery.md:547`
 * explains why at length, and the only durable form of that is being unable to
 * reach a reaction count. A test asserts the file has no imports at all, the
 * same construction significance scoring and search ranking use.
 *
 * Significance is consumed as contextual derived data, never as "one global
 * immutable rank" (`discovery.md:1547`). It orders candidates within a surface
 * and asserts nothing about what matters in general — which is the distinction
 * `discovery.md:85` draws between Discovery and historical truth.
 */

/**
 * Which ranking produced an order.
 *
 * Carried in every cursor, so a material change is diagnosable and a cursor
 * from the old ordering is refused rather than silently re-ranked.
 */
export const DISCOVERY_RANKING_VERSION = "discovery-v1";

/**
 * How much each signal is worth.
 *
 * Short by design. A Discovery ranking with many weights is one nobody can
 * reason about, and `discovery.md:1577` asks that the question be whether
 * surfacing something helps somebody explore meaningful history — not whether a
 * scoring function was tuned well.
 */
export const WEIGHT = {
  /** Derived historical significance, the primary term for Explore. */
  significance: 100,
  /**
   * Being older than the recent past.
   *
   * `discovery.md:664` asks that Discovery not overconcentrate on recent
   * history "merely because recent content generates more engagement", and that
   * it be able to reach yesterday, last year, and decades ago. A small constant
   * for anything beyond living memory of the feed is enough to stop the newest
   * uploads crowding out an archive that grows more valuable with age.
   */
  historical: 10,
} as const;

/**
 * The SQL expression that scores a candidate for Explore.
 *
 * @param alias - The alias the document table is joined under.
 * @param horizonParam - Which positional parameter carries the instant before
 *   which a Moment counts as historical rather than recent.
 * @returns A SQL numeric expression. Never returned to anybody: a number beside
 *   a recommendation reads as a claim about importance whatever it is labelled.
 */
export function discoveryScoreExpression(alias: string, horizonParam: number): string {
  return `(
    LEAST(1.0, COALESCE(${alias}.significance, 0) / 100.0) * ${WEIGHT.significance}
    + CASE WHEN ${alias}.occurrence_start < $${horizonParam} THEN ${WEIGHT.historical} ELSE 0 END
  )`;
}

/**
 * The ordering that follows a score.
 *
 * A total order, so the same surface twice gives the same page. Score, then
 * occurrence newest first, then identifier — the last is arbitrary and that is
 * the point: something has to settle a tie, and it must be something that
 * cannot change between two identical requests.
 *
 * @param alias - The alias the document table is joined under.
 * @param scored - The alias the computed score is selected as.
 * @returns A SQL ORDER BY body.
 */
export function discoveryOrder(alias: string, scored: string): string {
  return `${scored} DESC, ${alias}.occurrence_start DESC NULLS LAST, ${alias}.entity_id ASC`;
}

/**
 * The moderation states that permit amplification.
 *
 * The SQL twin of `suppressesAmplification`. It exists twice because a set
 * query cannot call a per-row function without breaking pagination, and a test
 * holds the two in agreement state by state — the discipline `visibleToViewer`
 * and `checkVisibility` already follow.
 *
 * Two states, and only two. Everything else — narrowed to an audience, age
 * restricted, withheld during review, removed, and the state that exists
 * precisely for this, `restricted_from_amplification` — is allowed to exist and
 * be reached and is never put in front of anybody.
 *
 * @returns The states, quoted for SQL.
 */
export function amplifiableStates(): readonly string[] {
  return ["allowed", "warned"];
}
