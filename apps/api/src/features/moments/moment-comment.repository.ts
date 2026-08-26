import type {
  Comment,
  CommentMention as CommentMentionContract,
  ReactionKind,
  ReactionSummary,
} from "@chronologity/contracts";
import { In, type DataSource } from "typeorm";
import type { Cursor } from "../../lib/pagination/cursor.js";
import type { Transaction } from "../../lib/database/transaction.js";
import { User } from "../users/user.model.js";
import { toPublicUser } from "../users/user.repository.js";
import {
  CommentMention,
  CommentReaction,
  MomentComment,
} from "./moment-comment.model.js";

/** A comment as stored, before anybody has decided what a Viewer may see of it. */
interface StoredComment {
  readonly row: MomentComment;
  readonly author: User | undefined;
}

const EMPTY_REACTIONS: ReactionSummary = {
  enabled: true,
  counts: {},
  total: 0,
  yours: null,
};

/**
 * The rule deciding whether a Viewer may read one comment, as SQL.
 *
 * Stated once and used by both the list and the count, which is the point: the
 * two said the same thing separately until moderation gave them a third clause
 * to disagree about, and a count that exceeds the comments a Viewer can
 * actually read is a visible lie about how many people spoke.
 *
 * The author is admitted first, so neither a suspension nor a moderator's
 * decision hides somebody's own words from them.
 *
 * Reads `:viewerUserId`, which the caller must supply.
 *
 * @param alias - The query-builder alias the comment table is joined under.
 * @returns A SQL condition, true when this Viewer may read the comment.
 */
export function commentReadableBy(alias: string): string {
  return `(
    ${alias}.author_user_id = :viewerUserId
    OR (
      NOT EXISTS (
        SELECT 1 FROM user_blocks b
         WHERE (b.blocker_user_id = ${alias}.author_user_id AND b.blocked_user_id = :viewerUserId)
            OR (b.blocker_user_id = :viewerUserId AND b.blocked_user_id = ${alias}.author_user_id)
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

/** Reads and writes discussion about Moments. */
export class MomentCommentRepository {
  /**
   * Build the comment repository.
   *
   * @param dataSource - Used for reads. Writes take a transaction of their own.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Record something somebody said.
   *
   * @param tx - The caller's transaction.
   * @param comment - Everything established when it was written.
   * @returns Whether it was recorded. False means that identifier was already
   *   used, which is how a retried submission is answered: the caller named the
   *   submission, so the second delivery finds the first and creates nothing
   *   (`comments.md:561`).
   */
  async add(
    tx: Transaction,
    comment: {
      commentId: string;
      momentId: string;
      authorUserId: string;
      threadCommentId: string | null;
      inReplyToCommentId: string | null;
      body: string;
      createdAt: Date;
    },
  ): Promise<boolean> {
    const inserted = await tx
      .createQueryBuilder()
      .insert()
      .into(MomentComment)
      .values({ ...comment, editedAt: null, deletedAt: null })
      .orIgnore()
      // Explicit, and checked by length: `orIgnore` populates `identifiers`
      // whether or not a row was written (ADR-102).
      .returning(["commentId"])
      .execute();

    return (inserted.raw as unknown[]).length > 0;
  }

  /**
   * Record who a comment refers to.
   *
   * @param tx - The caller's transaction.
   * @param commentId - Which comment.
   * @param userIds - Who it refers to, already resolved to people.
   * @param at - When.
   * @returns Nothing.
   */
  async addMentions(
    tx: Transaction,
    commentId: string,
    userIds: readonly string[],
    at: Date,
  ): Promise<void> {
    if (userIds.length === 0) {
      return;
    }

    await tx
      .createQueryBuilder()
      .insert()
      .into(CommentMention)
      .values(userIds.map((userId) => ({ commentId, userId, createdAt: at })))
      .orIgnore()
      .execute();
  }

  /**
   * Read one comment, whatever state it is in.
   *
   * @param commentId - Which comment.
   * @returns The row, or undefined. Deleted comments are returned, because the
   *   caller may need to know one exists in order to refuse an edit.
   */
  async findById(commentId: string): Promise<MomentComment | undefined> {
    const row = await this.dataSource.getRepository(MomentComment).findOneBy({ commentId });

    return row ?? undefined;
  }

  /**
   * Whether a comment has any replies that still stand.
   *
   * @param commentId - Which comment.
   * @returns Whether anything hangs from it. This is what decides between a
   *   tombstone and disappearing: a comment with replies must leave something
   *   for them to hang from (`comments.md:308`), and one without need not.
   */
  async hasReplies(commentId: string): Promise<boolean> {
    return this.dataSource
      .getRepository(MomentComment)
      .createQueryBuilder("reply")
      .where("reply.thread_comment_id = :commentId", { commentId })
      .andWhere("reply.deleted_at IS NULL")
      .getExists();
  }

  /**
   * Read a page of a discussion, oldest first.
   *
   * Ascending, unlike every other list in this system. `comments.md:198`
   * explains why: reading a conversation newest-first privileges recency over
   * the context that makes later replies comprehensible. The cursor comparison
   * inverts accordingly — `>` rather than `<`.
   *
   * @param momentId - Whose discussion.
   * @param threadCommentId - Null for the top level, or a comment for its
   *   thread.
   * @param viewerUserId - Who is asking, so their own reactions come back and
   *   so anybody they are blocked apart from is hidden.
   * @param limit - How many at most.
   * @param after - Where to continue from.
   * @returns The page. A deleted comment with replies is included as a
   *   tombstone; one without is omitted entirely.
   */
  async findPage(
    momentId: string,
    threadCommentId: string | null,
    viewerUserId: string,
    limit: number,
    after?: Cursor,
  ): Promise<Comment[]> {
    const query = this.dataSource
      .getRepository(MomentComment)
      .createQueryBuilder("comment")
      .leftJoinAndMapOne("comment.author", User, "author", "author.user_id = comment.author_user_id")
      .where("comment.moment_id = :momentId", { momentId });

    if (threadCommentId === null) {
      query.andWhere("comment.thread_comment_id IS NULL");
    } else {
      query.andWhere("comment.thread_comment_id = :threadCommentId", { threadCommentId });
    }

    // Blocking hides speech rather than deleting it, and only from the two
    // people involved: everybody else keeps a coherent conversation
    // (`comments.md:459`). Moderation and suspension are in the same rule.
    query.andWhere(commentReadableBy("comment"), { viewerUserId });

    // A deleted comment survives only as somewhere for replies to hang from.
    query.andWhere(
      `(comment.deleted_at IS NULL
        OR EXISTS (
          SELECT 1 FROM moment_comments reply
           WHERE reply.thread_comment_id = comment.comment_id
             AND reply.deleted_at IS NULL
        ))`,
    );

    if (after !== undefined) {
      query.andWhere("(comment.created_at, comment.comment_id) > (:at, :commentId)", {
        at: after.at,
        commentId: after.id,
      });
    }

    const rows = await query
      .orderBy("comment.created_at", "ASC")
      .addOrderBy("comment.comment_id", "ASC")
      .take(limit)
      .getMany();

    return this.decorate(rows, viewerUserId);
  }

  /**
   * Attach mentions and reaction counts to a page of comments.
   *
   * Two queries for the whole page rather than two per comment: a thread of
   * thirty would otherwise cost sixty round trips for information that groups
   * perfectly well.
   *
   * @param rows - The comments, as stored.
   * @param viewerUserId - Who is asking, so their own reactions come back.
   * @returns The comments as this Viewer receives them.
   */
  private async decorate(
    rows: readonly MomentComment[],
    viewerUserId: string,
  ): Promise<Comment[]> {
    if (rows.length === 0) {
      return [];
    }

    const commentIds = rows.map((row) => row.commentId);
    const mentions = await this.mentionsFor(commentIds);
    const reactions = await this.reactionsFor(commentIds, viewerUserId);

    return rows.map((row) => {
      const deleted = row.deletedAt !== null;
      const author = (row as unknown as StoredComment).author;

      return {
        commentId: row.commentId,
        momentId: row.momentId,
        // A tombstone carries neither text nor identity: `comments.md:339` asks
        // for a generic representation rather than one preserving an author
        // nobody needs to see.
        author: deleted || author === undefined ? null : toPublicUser(author),
        body: deleted ? null : row.body,
        deleted,
        threadCommentId: row.threadCommentId,
        inReplyToCommentId: row.inReplyToCommentId,
        mentions: deleted ? [] : (mentions.get(row.commentId) ?? []),
        reactions: reactions.get(row.commentId) ?? EMPTY_REACTIONS,
        createdAt: row.createdAt.toISOString(),
        editedAt: row.editedAt?.toISOString() ?? null,
      };
    });
  }

  /**
   * Read who a page of comments refers to.
   *
   * @param commentIds - The page.
   * @returns Mentions by comment, each carrying the handle as it stands now
   *   rather than the one that was typed.
   */
  private async mentionsFor(
    commentIds: readonly string[],
  ): Promise<Map<string, CommentMentionContract[]>> {
    const rows = await this.dataSource
      .getRepository(CommentMention)
      .createQueryBuilder("mention")
      .innerJoin(User, "user", "user.user_id = mention.user_id")
      .select(["mention.comment_id AS comment_id", "user.user_id AS user_id", "user.handle AS handle"])
      .where({ commentId: In([...commentIds]) })
      .orderBy("mention.created_at", "ASC")
      .getRawMany<{ comment_id: string; user_id: string; handle: string }>();

    const byComment = new Map<string, CommentMentionContract[]>();

    for (const row of rows) {
      const existing = byComment.get(row.comment_id) ?? [];

      existing.push({ userId: row.user_id, handle: row.handle });
      byComment.set(row.comment_id, existing);
    }

    return byComment;
  }

  /**
   * Count how a page of comments has been responded to.
   *
   * @param commentIds - The page.
   * @param viewerUserId - Who is asking, so their own comes back.
   * @returns A summary per comment. `enabled` is always true: a comment carries
   *   no switch of its own, and a Moment's reaction setting deliberately does
   *   not reach the discussion underneath it.
   */
  private async reactionsFor(
    commentIds: readonly string[],
    viewerUserId: string,
  ): Promise<Map<string, ReactionSummary>> {
    const counted = await this.dataSource
      .getRepository(CommentReaction)
      .createQueryBuilder("reaction")
      .select("reaction.comment_id", "commentId")
      .addSelect("reaction.kind", "kind")
      .addSelect("COUNT(*)", "count")
      .where({ commentId: In([...commentIds]) })
      // As on Moment reactions: a suspended account stops counting, nothing is
      // deleted, and reinstatement restores the totals exactly.
      .andWhere(
        `NOT EXISTS (
           SELECT 1 FROM users reactor
            WHERE reactor.user_id = reaction.user_id
              AND reactor.status = 'suspended'
         )`,
      )
      .groupBy("reaction.comment_id")
      .addGroupBy("reaction.kind")
      .getRawMany<{ commentId: string; kind: string; count: string }>();

    const mine = await this.dataSource
      .getRepository(CommentReaction)
      .find({ where: { commentId: In([...commentIds]), userId: viewerUserId } });

    const yours = new Map(mine.map((row) => [row.commentId, row.kind as ReactionKind]));
    const summaries = new Map<string, ReactionSummary>();

    for (const row of counted) {
      const existing = summaries.get(row.commentId) ?? {
        enabled: true,
        counts: {} as Partial<Record<ReactionKind, number>>,
        total: 0,
        yours: yours.get(row.commentId) ?? null,
      };
      const count = Number(row.count);

      existing.counts[row.kind as ReactionKind] = count;
      summaries.set(row.commentId, { ...existing, total: existing.total + count });
    }

    // Somebody may hold a reaction on a comment nobody else has touched.
    for (const [commentId, kind] of yours) {
      if (!summaries.has(commentId)) {
        summaries.set(commentId, { enabled: true, counts: {}, total: 0, yours: kind });
      }
    }

    return summaries;
  }

  /**
   * Count a whole discussion.
   *
   * @param momentId - Whose discussion.
   * @param viewerUserId - Who is asking, so what a Block hides is not counted.
   * @returns How many comments there are, replies included
   *   (`comments.md:230`), excluding deleted ones and anything hidden by a
   *   Block. A count that included what the Viewer cannot see would invite them
   *   to go looking for it.
   */
  async count(momentId: string, viewerUserId: string): Promise<number> {
    return this.dataSource
      .getRepository(MomentComment)
      .createQueryBuilder("comment")
      .where("comment.moment_id = :momentId", { momentId })
      .andWhere("comment.deleted_at IS NULL")
      .andWhere(commentReadableBy("comment"), { viewerUserId })
      .getCount();
  }

  /**
   * Who wrote one comment.
   *
   * @param tx - The caller's transaction, so this reads what the same
   *   transaction has just written.
   * @param commentId - Which comment.
   * @returns Its author, or undefined when there is no such comment or it has
   *   been withdrawn — a tombstone has nobody to answer.
   */
  async authorOf(tx: Transaction, commentId: string): Promise<string | undefined> {
    const rows: { author_user_id: string }[] = await tx.query(
      "SELECT author_user_id FROM moment_comments WHERE comment_id = $1 AND deleted_at IS NULL",
      [commentId],
    );

    return rows[0]?.author_user_id;
  }

  /**
   * Change what a comment says.
   *
   * @param tx - The caller's transaction.
   * @param commentId - Which comment.
   * @param body - What it says now.
   * @param at - When it was changed.
   * @returns Nothing. `created_at` is untouched, so the comment keeps its place
   *   in the conversation (`comments.md:271`).
   */
  async edit(tx: Transaction, commentId: string, body: string, at: Date): Promise<void> {
    await tx.update(MomentComment, { commentId }, { body, editedAt: at });
  }

  /**
   * Replace who a comment refers to.
   *
   * @param tx - The caller's transaction.
   * @param commentId - Which comment.
   * @returns Nothing. Editing rewrites the text, so the mentions it carried are
   *   re-read from what it now says rather than accumulating.
   */
  async clearMentions(tx: Transaction, commentId: string): Promise<void> {
    await tx.delete(CommentMention, { commentId });
  }

  /**
   * Take a comment back.
   *
   * @param tx - The caller's transaction.
   * @param commentId - Which comment.
   * @param at - When.
   * @returns Nothing. Soft, so a tombstone can stand where replies hang from
   *   it, and so nothing about the Moment itself changes.
   */
  async softDelete(tx: Transaction, commentId: string, at: Date): Promise<void> {
    await tx.update(MomentComment, { commentId }, { deletedAt: at, body: "" });
  }

  /**
   * React to a comment, or change how.
   *
   * @param tx - The caller's transaction.
   * @param commentId - Which comment.
   * @param userId - Who is reacting.
   * @param kind - Which of the four.
   * @param at - When.
   * @returns Nothing.
   */
  async react(
    tx: Transaction,
    commentId: string,
    userId: string,
    kind: ReactionKind,
    at: Date,
  ): Promise<void> {
    await tx
      .createQueryBuilder()
      .insert()
      .into(CommentReaction)
      .values({ commentId, userId, kind, createdAt: at, updatedAt: at })
      .orUpdate(["kind", "updated_at"], ["comment_id", "user_id"])
      .execute();
  }

  /**
   * Take a reaction to a comment back.
   *
   * @param tx - The caller's transaction.
   * @param commentId - Which comment.
   * @param userId - Who is withdrawing.
   * @returns Nothing.
   */
  async unreact(tx: Transaction, commentId: string, userId: string): Promise<void> {
    await tx.delete(CommentReaction, { commentId, userId });
  }

  /**
   * Remove the reactions two people left on each other's comments.
   *
   * Called inside the transaction that records a Block, alongside the Moment
   * reactions ADR-113 already severs. Tallies are severed; speech is hidden,
   * because hiding a comment from two people is not the same as deleting it
   * from everybody.
   *
   * @param tx - The caller's transaction.
   * @param oneUserId - One of them.
   * @param otherUserId - The other.
   * @returns Nothing.
   */
  async severReactionsBetween(
    tx: Transaction,
    oneUserId: string,
    otherUserId: string,
  ): Promise<void> {
    await tx
      .createQueryBuilder()
      .delete()
      .from(CommentReaction)
      .where(
        `(user_id = :oneUserId AND comment_id IN (
            SELECT comment_id FROM moment_comments WHERE author_user_id = :otherUserId
          ))
         OR (user_id = :otherUserId AND comment_id IN (
            SELECT comment_id FROM moment_comments WHERE author_user_id = :oneUserId
          ))`,
        { oneUserId, otherUserId },
      )
      .execute();
  }
}
