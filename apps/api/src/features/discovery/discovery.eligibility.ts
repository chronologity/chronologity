import { eligibleForViewer } from "../search/search.eligibility.js";
import { amplifiableStates } from "./discovery.ranking.js";

/**
 * What may be offered to somebody who did not ask for it.
 *
 * Built on top of the Search rule and never beside it. `eligibleForViewer` is
 * reused verbatim, and everything here narrows it further — because a Discovery
 * path with its own copy of the access rule is exactly how Discovery becomes
 * the way around privacy that Search already closes, which the roadmap names as
 * the thing this phase must not produce.
 *
 * The narrowing is the point:
 *
 * ```text
 * may view directly  !=  may be searched  !=  may be recommended
 * ```
 *
 * `discovery.md:159` states the rule the floors below enforce: a recommendation
 * system must never use its ability to infer that content exists as permission
 * to expose it.
 */

/**
 * The eligibility condition for a recommendation.
 *
 * Reads `:viewerUserId`, `:viewerIsAdult`, and `:adultBornBefore`, which the
 * caller must supply. The Viewer's own adulthood decides what they may be
 * shown; the *author's* decides whether their history may be shown to anybody.
 *
 * @param alias - The alias the document table is joined under.
 * @returns A SQL condition, true when this candidate may be recommended to this
 *   Viewer.
 */
export function discoverableForViewer(alias: string): string {
  // Built outside the template. A nested template literal inside a SQL string
  // terminates the outer one — the same trap a backtick in a SQL comment set in
  // the search retrieval, one level deeper.
  const amplifiable = amplifiableStates()
    .map((state) => `'${state}'`)
    .join(", ");

  return `(
    -- Everything access requires, unchanged. Blocking, suspension, audience,
    -- the age gate, deletion, and searchability all arrive through here.
    ${eligibleForViewer(alias)}

    -- Surfaces recommend Moments. Accounts, Events, and Locations are how
    -- somebody navigates; they are not history being put in front of them.
    AND ${alias}.entity_type = 'moment'

    -- The author's own choice. Unlisting leaves a Moment reachable by anybody
    -- holding the link and takes it out of every surface.
    AND ${alias}.discoverable = true

    -- Public only. A restricted Moment is never recommended, not even to
    -- somebody on its list: being invited to see something is not the same as
    -- asking to be shown it, and a recommendation would announce it to a person
    -- who had not thought about it in years. A private Moment is excluded by
    -- the same clause, including from its own author — Discovery offers history
    -- to explore, and your own private history is not something to be offered.
    AND ${alias}.visibility = 'public'

    -- The floor moderation sets. Everything but allowed and warned is allowed
    -- to exist, allowed to be reached, and never amplified — the line
    -- moderation.md:211 draws, and the reason the restricted_from_amplification
    -- state exists at all.
    AND ${alias}.moderation_state IN (${amplifiable})

    -- The floor age sets, on the author rather than the Viewer.
    AND ${authorIsAdult(alias)}
  )`;
}

/**
 * Whether the account behind a candidate is an adult.
 *
 * `discovery.md:926` asks that Chronologity avoid broad recommendation of
 * sensitive personal history involving children "merely because the underlying
 * Moment is technically visible". This is where that stops being a sentiment: a
 * young person's history is reachable by whoever they shared it with and is
 * never put in front of strangers.
 *
 * Resolved at query time against `user_restricted_data` rather than indexed.
 * A birthday is the one fact that changes without anything happening — indexing
 * it would mean somebody stayed excluded until a worker noticed they had turned
 * eighteen, and a stale exclusion here is a person's history quietly missing
 * from the platform.
 *
 * That table is deliberately separate so no query written against `users` can
 * return a birthdate by accident. This reads it to make a decision and returns
 * nothing from it, which is the distinction that keeps the separation
 * meaningful — but it is the second place in the system that touches it, and
 * that is worth knowing.
 *
 * @param alias - The alias the document table is joined under.
 * @returns A SQL condition. False where no birthdate is recorded: ambiguous
 *   security-sensitive state defaults to deny, and an account whose age cannot
 *   be established is treated as a young person's rather than waved through.
 */
function authorIsAdult(alias: string): string {
  return `EXISTS (
    SELECT 1 FROM user_restricted_data author_age
     WHERE author_age.user_id = ${alias}.author_user_id
       AND author_age.date_of_birth <= :adultBornBefore
  )`;
}
