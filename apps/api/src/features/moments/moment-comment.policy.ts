import { COMMENT_MAX_LENGTH, type CommentPolicy } from "@chronologity/contracts";

/**
 * Who may join a discussion, and what may be said.
 *
 * Pure. Being able to see a Moment does not by itself mean being able to
 * comment on it — `comments.md:417` asks that `Can view ≠ Can comment` stay
 * true in the model — and three things can withhold the second while leaving
 * the first intact.
 *
 * The `followers` policy grants no access to anybody. A stranger who could read
 * the Moment still can; what changes is whether they may speak. That is why it
 * does not contradict `social-graph.md`'s rule that a Follow never bypasses a
 * visibility rule: nothing here is a visibility rule.
 */

/** Why somebody may not comment. */
export type CommentRefusal = "blocked" | "comments_disabled" | "not_a_follower" | "unknown_policy";

/** Why something may not be said. */
export type CommentBodyRefusal = "empty" | "too_long";

/** What the caller had to establish before the comment could be judged. */
export interface CommentFacts {
  /** Who wrote the Moment. */
  readonly authorUserId: string;
  /** Who wants to speak. */
  readonly viewerUserId: string;
  /** Whether they follow the author. Only consulted under `followers`. */
  readonly followsAuthor: boolean;
  /** Whether a Block separates them. */
  readonly blockedEitherWay: boolean;
}

/**
 * Decide whether somebody may comment.
 *
 * Blocking is answered first, and the Moment's own policy second, for the
 * reason the reaction policy uses: a Block is a safety boundary and an author's
 * interaction preference is not, so a blocked person should not be able to
 * learn which policy is set on history they cannot see.
 *
 * An author may always comment on their own Moment. `disabled` closes the
 * discussion to other people; it is not a way of silencing oneself, and
 * `followers` cannot be satisfied by somebody who does not follow themselves.
 *
 * @param policy - Who the author said may join.
 * @param facts - Authorship, who is asking, whether they follow, and whether a
 *   Block separates them.
 * @returns Why to refuse, or undefined when they may comment.
 */
export function checkComment(
  policy: CommentPolicy,
  facts: CommentFacts,
): CommentRefusal | undefined {
  if (facts.blockedEitherWay) {
    return "blocked";
  }

  if (facts.authorUserId === facts.viewerUserId) {
    return undefined;
  }

  switch (policy) {
    case "anyone":
      return undefined;
    case "followers":
      return facts.followsAuthor ? undefined : "not_a_follower";
    case "disabled":
      return "comments_disabled";
    default:
      // Unreachable while the column constraint and the contract agree, and
      // deliberately here anyway: a policy nobody recognises must close the
      // discussion rather than open it.
      return "unknown_policy";
  }
}

/**
 * Decide whether something may be said.
 *
 * @param body - What was typed.
 * @returns Why to refuse, or undefined. A comment must carry meaningful visible
 *   content after normalisation (`comments.md:553`), so whitespace alone is not
 *   a comment — and a limit exists so that comments do not quietly become an
 *   alternative long-form publishing system (`comments.md:545`).
 */
export function checkCommentBody(body: string): CommentBodyRefusal | undefined {
  const normalized = body.trim();

  if (normalized.length === 0) {
    return "empty";
  }

  if (normalized.length > COMMENT_MAX_LENGTH) {
    return "too_long";
  }

  return undefined;
}

/**
 * Say why somebody may not comment.
 *
 * @param reason - The refusal.
 * @returns A sentence for whoever tried. A Block is never named: telling
 *   somebody they have been blocked is precisely what the product must not do,
 *   so it reads as the discussion simply being closed.
 */
export function describeCommentRefusal(reason: CommentRefusal): string {
  switch (reason) {
    case "blocked":
    case "comments_disabled":
    case "unknown_policy":
      return "This moment is not accepting comments";
    case "not_a_follower":
      return "Only people who follow the author may comment on this moment";
  }
}

/**
 * Say why something may not be said.
 *
 * @param reason - The refusal.
 * @returns A sentence naming what is wrong, so it can be fixed.
 */
export function describeCommentBodyRefusal(reason: CommentBodyRefusal): string {
  switch (reason) {
    case "empty":
      return "A comment needs something in it";
    case "too_long":
      return `A comment may be at most ${COMMENT_MAX_LENGTH} characters`;
  }
}
