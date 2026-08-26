/**
 * Who may find what.
 *
 * One SQL fragment, the way `visibleToViewer` is one fragment for Moments, and
 * for the same reason: a rule written in several places eventually disagrees
 * with itself, and this is the rule that leaks if it is wrong.
 *
 * It belongs in the query and nowhere else. `search.md:249` draws the line —
 * filter, then rank, then paginate, never rank, paginate, then filter. Removing
 * ineligible results after the fact leaks through page sizes, result counts,
 * and pagination gaps even when the restricted thing is never displayed.
 *
 * This is the query-time half of a two-stage rule. The index already carries
 * what is intrinsic: whether moderation permits the thing to be found at all,
 * and whether it has been deleted. What is left is everything that depends on
 * who is asking, which the index cannot know.
 */

/**
 * The eligibility condition.
 *
 * Reads `:viewerUserId` and `:viewerIsAdult`, which the caller must supply.
 * There is no variant that omits them: an anonymous Viewer is an explicit
 * context rather than the absence of one, and a caller who forgot to pass a
 * Viewer would otherwise get everybody's history.
 *
 * @param alias - The alias the document table is joined under.
 * @returns A SQL condition, true when this Viewer may be shown this document.
 */
export function eligibleForViewer(alias: string): string {
  return `(
    ${alias}.deleted = false
    AND ${alias}.searchable = true
    AND (
      -- Your own, whatever state it is in. This is why searchability and
      -- visibility are separate columns: folding them together would filter
      -- the author out before anybody knew who was asking, and nobody could
      -- search their own private history.
      ${alias}.author_user_id = :viewerUserId
      OR (
        ${authorPermits(alias)}
        AND ${notBlocked(alias)}
        AND ${audiencePermits(alias)}
        AND ${agePermits(alias)}
      )
    )
  )`;
}

/**
 * Whether the account behind a document allows it to be found.
 *
 * Two rules rather than one, because the two entity types mean different
 * things. A suspended person's Moments are withheld while their account is;
 * a *deactivated* person's Moments are not, since deactivation is their own
 * decision about their account rather than about their history. But the account
 * itself is absent from Search either way, exactly as it is absent from the
 * public profile view.
 *
 * @param alias - The alias the document table is joined under.
 * @returns A SQL condition.
 */
function authorPermits(alias: string): string {
  return `(
    ${alias}.author_user_id IS NULL
    OR EXISTS (
      SELECT 1 FROM users author
       WHERE author.user_id = ${alias}.author_user_id
         AND CASE
               WHEN ${alias}.entity_type = 'user' THEN author.status = 'active'
               ELSE author.status <> 'suspended'
             END
    )
  )`;
}

/**
 * Whether a Block stands between the Viewer and whoever this belongs to.
 *
 * Both directions. An asymmetric rule would leave the blocker still finding the
 * history of somebody they wanted nothing to do with, and would let the blocked
 * person infer the Block from results that stopped appearing one way only.
 *
 * @param alias - The alias the document table is joined under.
 * @returns A SQL condition.
 */
function notBlocked(alias: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM user_blocks b
     WHERE (b.blocker_user_id = ${alias}.author_user_id AND b.blocked_user_id = :viewerUserId)
        OR (b.blocker_user_id = :viewerUserId AND b.blocked_user_id = ${alias}.author_user_id)
  )`;
}

/**
 * Whether the audience admits the Viewer.
 *
 * Covers both ways a thing can be narrowed: the author choosing `restricted`,
 * and moderation deciding it should reach fewer people than its author meant.
 * The second overrides a public visibility rather than deferring to it.
 *
 * @param alias - The alias the document table is joined under.
 * @returns A SQL condition.
 */
function audiencePermits(alias: string): string {
  return `(
    (
      ${alias}.visibility = 'public'
      AND ${alias}.moderation_state <> 'restricted_to_authorized_audience'
    )
    OR EXISTS (
      SELECT 1 FROM moment_audience a
       WHERE a.moment_id = ${alias}.entity_id AND a.user_id = :viewerUserId
    )
  )`;
}

/**
 * Whether the Viewer is old enough for this.
 *
 * Resolved once per request and passed as a parameter rather than joined per
 * row. A Viewer whose age cannot be established is not an adult: ambiguous
 * security-sensitive state defaults to deny.
 *
 * @param alias - The alias the document table is joined under.
 * @returns A SQL condition.
 */
function agePermits(alias: string): string {
  return `(${alias}.moderation_state <> 'age_restricted' OR :viewerIsAdult)`;
}
