import type { ViewerPlaceholders } from "./placeholders.js";

/**
 * The rule deciding whether a Viewer may see a Moment, as SQL.
 *
 * The same rule `checkVisibility` states in TypeScript. It exists twice because
 * a set query cannot call a per-row function without breaking keyset
 * pagination, and it exists here exactly once so that a third and fourth reader
 * do not each write their own — which is the mistake ADR-107 records about
 * cursors.
 *
 * Being the single statement of the rule is what made moderation tractable:
 * suspension, removal, temporary unavailability, audience narrowing, and the
 * age gate all landed in it, and every existing reader received them without
 * being changed.
 *
 * Reads the Viewer and their age, which the caller must supply. The second is
 * resolved once per request rather than joined per row, and is required rather
 * than optional so that supplying it could not be forgotten: the compiler names
 * every caller.
 *
 * @param alias - The alias the Moment table is joined under.
 * @param viewer - How this caller's client spells a bound value.
 * @returns A SQL condition combining both halves.
 */
export function visibleToViewer(alias: string, viewer: ViewerPlaceholders): string {
  return `(${privacyPermits(alias, viewer)} AND ${moderationPermits(alias, viewer)})`;
}

/**
 * The half of the rule that is about people.
 *
 * Blocking and the author's own audience choice. Ordered as the policy is: the
 * author first, then blocking, then visibility, so a Block cannot be outlived
 * by an invitation issued before it.
 *
 * Exported because the two halves have to be asked separately in one place.
 * A relationship read shows a tombstone where moderation took the far end, and
 * shows nothing at all where privacy did — `privacy.md:158` requires that
 * Chronologity "must never use a visible relationship to reveal an inaccessible
 * Moment", and a tombstone standing where a private Moment sits would announce
 * that somebody's private history exists and is connected to something. That a
 * platform removed something is Chronologity's own act to admit; that a person
 * kept something private is theirs.
 *
 * @param alias - The alias the Moment table is joined under.
 * @param viewer - How this caller's client spells the Viewer. Deliberately not
 *   the whole set: this half must not depend on an age, and taking only what it
 *   reads is what stops a caller binding one in.
 * @returns A SQL condition, true when no privacy rule withholds the Moment.
 */
export function privacyPermits(
  alias: string,
  viewer: Pick<ViewerPlaceholders, "viewerUserId">,
): string {
  return `(
    ${alias}.author_user_id = ${viewer.viewerUserId}
    OR (
      NOT EXISTS (
        SELECT 1 FROM user_blocks b
         WHERE (b.blocker_user_id = ${alias}.author_user_id AND b.blocked_user_id = ${viewer.viewerUserId})
            OR (b.blocker_user_id = ${viewer.viewerUserId} AND b.blocked_user_id = ${alias}.author_user_id)
      )
      AND (
        ${alias}.visibility = 'public'
        OR EXISTS (
          SELECT 1 FROM moment_audience a
           WHERE a.moment_id = ${alias}.moment_id AND a.user_id = ${viewer.viewerUserId}
        )
      )
    )
  )`;
}

/**
 * The half of the rule that is about what Chronologity decided.
 *
 * The author is admitted first here as well, so neither a suspension nor a
 * moderator's decision hides somebody's own history from them. That is not a
 * courtesy: somebody who cannot see what was hidden cannot meaningfully appeal
 * it, and `moderation.md:680` expects the reason for an action to reach the
 * person it affected.
 *
 * `warned` and `restricted_from_amplification` are deliberately absent. Neither
 * hides anything from a direct reader, which is the line `moderation.md:211`
 * draws between existing, being reachable directly, and being promoted; the
 * second is enforced by the surfaces that amplify.
 *
 * @param alias - The alias the Moment table is joined under.
 * @param viewer - How this caller's client spells a bound value.
 * @returns A SQL condition, true when no moderation decision withholds the
 *   Moment from this Viewer.
 */
export function moderationPermits(alias: string, viewer: ViewerPlaceholders): string {
  return `(
    ${alias}.author_user_id = ${viewer.viewerUserId}
    OR (
      NOT EXISTS (
        SELECT 1 FROM users author
         WHERE author.user_id = ${alias}.author_user_id
           AND author.status = 'suspended'
      )
      AND NOT EXISTS (
        SELECT 1 FROM moderation_states ms
         WHERE ms.subject_type = 'moment'
           AND ms.subject_id = ${alias}.moment_id
           AND (
             ms.state IN ('removed', 'temporarily_unavailable')
             OR (ms.state = 'age_restricted' AND NOT ${viewer.viewerIsAdult})
             OR (
               ms.state = 'restricted_to_authorized_audience'
               AND NOT EXISTS (
                 SELECT 1 FROM moment_audience a
                  WHERE a.moment_id = ${alias}.moment_id AND a.user_id = ${viewer.viewerUserId}
               )
             )
           )
      )
    )
  )`;
}
