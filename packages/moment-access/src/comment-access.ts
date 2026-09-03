import type { ViewerPlaceholders } from "./placeholders.js";

/**
 * The rule deciding whether a Viewer may read a comment.
 *
 * Its own rule rather than the Moment's, because the two withhold for different
 * reasons. Reaching a comment means having passed the Moment above it, so this
 * asks nothing about visibility or age; what it asks about is the commenter —
 * whether the reader is separated from them by a Block, whether they are
 * suspended, and whether Chronologity took the comment down.
 *
 * Stated once and used by both the list and the count, which is the point: the
 * two said the same thing separately until moderation gave them a third clause
 * to disagree about, and a count that exceeds the comments a Viewer can
 * actually read is a visible lie about how many people spoke.
 *
 * The author is admitted first, so neither a suspension nor a moderator's
 * decision hides somebody's own words from them.
 *
 * @param alias - The alias the comment table is joined under.
 * @param viewer - How this caller's client spells the Viewer. No age: comments
 *   carry no age gate, and taking one would invite a caller to bind it.
 * @returns A SQL condition, true when this Viewer may read the comment.
 */
export function commentReadableBy(
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
      AND NOT EXISTS (
        SELECT 1 FROM users commenter
         WHERE commenter.user_id = ${alias}.author_user_id
           AND commenter.status = 'suspended'
      )
      AND NOT EXISTS (
        SELECT 1 FROM moderation_states ms
         WHERE ms.subject_type = 'comment'
           AND ms.subject_id = ${alias}.comment_id
           AND ms.state IN ('removed', 'temporarily_unavailable')
      )
    )
  )`;
}
