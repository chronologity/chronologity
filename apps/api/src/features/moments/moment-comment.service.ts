import { randomUUID } from "node:crypto";
import type {
  Comment,
  CommentPage,
  CreateCommentRequest,
  ReactionKind,
  SetCommentPolicyRequest,
} from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { withTransaction } from "../../lib/database/transaction.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import { decodeCursor, encodeCursor } from "../../lib/pagination/cursor.js";
import type { FollowRepository } from "../social/follow.repository.js";
import type { UserRepository } from "../users/user.repository.js";
import { MAXIMUM_MENTIONS, findMentionedHandles } from "./comment-mentions.js";
import {
  checkComment,
  checkCommentBody,
  describeCommentBodyRefusal,
  describeCommentRefusal,
} from "./moment-comment.policy.js";
import type { MomentCommentRepository } from "./moment-comment.repository.js";
import type { MomentRepository } from "./moment.repository.js";
import type { MomentService } from "./moment.service.js";

/**
 * Discussion about a Moment.
 *
 * Conversation rather than history (`comments.md:58`): a comment written in
 * 2029 about a photograph from 1988 leaves that photograph in 1988, and nothing
 * here ever touches a Moment's occurrence.
 *
 * Every read is bounded by the Moment's own visibility (`comments.md:373`), and
 * every write by three further questions: whether a Block separates the two
 * people, what the author said about who may join, and whether what was typed
 * is a comment at all.
 */
export class MomentCommentService {
  /**
   * Build the comment service.
   *
   * @param dataSource - Opens the transactions this service's writes commit in.
   * @param comments - Where discussion is stored.
   * @param moments - Reads the Moment's own state, including its comment policy.
   * @param momentAccess - Proves the Moment is one this Viewer may see. Reused
   *   rather than reimplemented.
   * @param follows - Used to ask whether somebody follows the author, and
   *   whether a Block separates two people.
   * @param users - Resolves a mentioned handle to a person.
   * @param clock - Injected so tests can move time without waiting.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly comments: MomentCommentRepository,
    private readonly moments: MomentRepository,
    private readonly momentAccess: MomentService,
    private readonly follows: FollowRepository,
    private readonly users: UserRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Say something about a Moment, or reply to something already said.
   *
   * @param momentId - What is being discussed.
   * @param viewerUserId - Who is speaking.
   * @param request - What they said, what they are replying to, and optionally
   *   which submission this is.
   * @returns The comment as recorded.
   * @throws {NotFoundError} If there is no such Moment or they may not see it,
   *   or if they are replying to a comment that is not part of it.
   * @throws {ValidationError} If they may not comment, if what they typed is
   *   not a comment, or if it refers to somebody they are blocked apart from.
   */
  async add(
    momentId: string,
    viewerUserId: string,
    request: CreateCommentRequest,
  ): Promise<Comment> {
    const moment = await this.momentAccess.get(momentId, viewerUserId);
    const policy = await this.moments.commentPolicy(momentId);

    const bodyRefusal = checkCommentBody(request.body);

    if (bodyRefusal !== undefined) {
      throw new ValidationError(describeCommentBodyRefusal(bodyRefusal), { field: "body" });
    }

    const refusal = checkComment(policy, {
      authorUserId: moment.authorUserId,
      viewerUserId,
      followsAuthor: await this.follows.exists(viewerUserId, moment.authorUserId),
      blockedEitherWay: await this.isBlocked(moment.authorUserId, viewerUserId),
    });

    if (refusal !== undefined) {
      throw new ValidationError(describeCommentRefusal(refusal), { field: "body" });
    }

    const { threadCommentId, inReplyToCommentId } = await this.placeInThread(
      momentId,
      request.inReplyToCommentId,
    );
    const mentioned = await this.resolveMentions(request.body, viewerUserId);

    const commentId = request.commentId ?? randomUUID();
    const at = this.clock();

    const recorded = await withTransaction(this.dataSource, async (tx) => {
      const added = await this.comments.add(tx, {
        commentId,
        momentId,
        authorUserId: viewerUserId,
        threadCommentId,
        inReplyToCommentId,
        body: request.body.trim(),
        createdAt: at,
      });

      if (added) {
        await this.comments.addMentions(tx, commentId, mentioned, at);
      }

      return added;
    });

    if (!recorded) {
      // The caller named this submission and it is already here. A retry, not a
      // second comment (`comments.md:561`).
      return this.read(commentId, viewerUserId);
    }

    return this.read(commentId, viewerUserId);
  }

  /**
   * Work out where a comment belongs in the conversation.
   *
   * Replying to a reply joins that reply's thread rather than nesting deeper,
   * which is what keeps presentation to one visible level
   * (`comments.md:161`). Which comment was actually addressed is kept
   * separately, because without it a reply aimed at one person in a busy thread
   * loses who it was answering.
   *
   * @param momentId - The Moment being discussed.
   * @param inReplyToCommentId - What is being replied to, if anything.
   * @returns The thread to join and the comment addressed.
   * @throws {NotFoundError} If the comment replied to is not part of this
   *   Moment's discussion.
   */
  private async placeInThread(
    momentId: string,
    inReplyToCommentId: string | undefined,
  ): Promise<{ threadCommentId: string | null; inReplyToCommentId: string | null }> {
    if (inReplyToCommentId === undefined) {
      return { threadCommentId: null, inReplyToCommentId: null };
    }

    const parent = await this.comments.findById(inReplyToCommentId);

    if (parent === undefined || parent.momentId !== momentId) {
      throw new NotFoundError("No such comment");
    }

    return {
      threadCommentId: parent.threadCommentId ?? parent.commentId,
      inReplyToCommentId,
    };
  }

  /**
   * Resolve the handles a comment mentions to people.
   *
   * @param body - What was typed.
   * @param viewerUserId - Who is speaking.
   * @returns The people mentioned. A handle nobody holds simply produces no
   *   mention and the text stands as typed.
   * @throws {ValidationError} If it names more people than a comment may, or
   *   somebody a Block separates them from — `comments.md:511` requires that a
   *   mention never become a way around a safety boundary.
   */
  private async resolveMentions(body: string, viewerUserId: string): Promise<string[]> {
    const handles = findMentionedHandles(body);

    if (handles.length > MAXIMUM_MENTIONS) {
      throw new ValidationError(
        `A comment may mention at most ${MAXIMUM_MENTIONS} people`,
        { field: "body" },
      );
    }

    const resolved: string[] = [];

    for (const handle of handles) {
      // The live holder of the handle. A released handle may since have been
      // taken by somebody else, and resolving on an old claim would refer to
      // the wrong person.
      const userId = await this.users.findIdByHandle(handle);

      if (userId === undefined) {
        continue;
      }

      if (await this.isBlocked(userId, viewerUserId)) {
        throw new ValidationError("You cannot mention that person", { field: "body" });
      }

      resolved.push(userId);
    }

    return resolved;
  }

  /**
   * Read one comment as this Viewer receives it.
   *
   * @param commentId - Which comment.
   * @param viewerUserId - Who is asking.
   * @returns The comment.
   * @throws {NotFoundError} If there is no such comment, or the Moment it
   *   belongs to is not one this Viewer may see.
   */
  private async read(commentId: string, viewerUserId: string): Promise<Comment> {
    const stored = await this.comments.findById(commentId);

    if (stored === undefined) {
      throw new NotFoundError("No such comment");
    }

    await this.momentAccess.get(stored.momentId, viewerUserId);

    const page = await this.comments.findPage(
      stored.momentId,
      stored.threadCommentId,
      viewerUserId,
      1,
      // One before it, so the page begins with the comment itself.
      { at: new Date(stored.createdAt.getTime() - 1), id: stored.commentId },
    );
    const found = page.find((comment) => comment.commentId === commentId);

    if (found === undefined) {
      throw new NotFoundError("No such comment");
    }

    return found;
  }

  /**
   * Read a page of a Moment's discussion, oldest first.
   *
   * @param momentId - Whose discussion.
   * @param viewerUserId - Who is asking.
   * @param limit - How many at most.
   * @param cursor - Where to continue from.
   * @returns The page, the number of comments including replies, and where the
   *   next page continues from.
   * @throws {NotFoundError} If there is no such Moment or they may not see it.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async list(
    momentId: string,
    viewerUserId: string,
    limit: number,
    cursor?: string,
  ): Promise<CommentPage> {
    await this.momentAccess.get(momentId, viewerUserId);

    const comments = await this.comments.findPage(
      momentId,
      null,
      viewerUserId,
      limit,
      decodeCursor(cursor),
    );

    return this.page(comments, limit, await this.comments.count(momentId, viewerUserId));
  }

  /**
   * Read a page of one thread, oldest first.
   *
   * @param commentId - The top-level comment whose thread this is.
   * @param viewerUserId - Who is asking.
   * @param limit - How many at most.
   * @param cursor - Where to continue from.
   * @returns The page.
   * @throws {NotFoundError} If there is no such comment, or the Moment it
   *   belongs to is not one this Viewer may see.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async replies(
    commentId: string,
    viewerUserId: string,
    limit: number,
    cursor?: string,
  ): Promise<CommentPage> {
    const stored = await this.comments.findById(commentId);

    if (stored === undefined) {
      throw new NotFoundError("No such comment");
    }

    await this.momentAccess.get(stored.momentId, viewerUserId);

    const comments = await this.comments.findPage(
      stored.momentId,
      commentId,
      viewerUserId,
      limit,
      decodeCursor(cursor),
    );

    return this.page(comments, limit, comments.length);
  }

  /**
   * Shape a page, and say where the next one continues from.
   *
   * @param comments - What was read.
   * @param limit - What was asked for.
   * @param total - How many there are altogether.
   * @returns The page. A full page means there is probably more; a short one
   *   means there is not.
   */
  private page(comments: Comment[], limit: number, total: number): CommentPage {
    const last = comments.length === limit ? comments[comments.length - 1] : undefined;

    return {
      comments,
      total,
      ...(last === undefined
        ? {}
        : { nextCursor: encodeCursor(new Date(last.createdAt), last.commentId) }),
    };
  }

  /**
   * Change what a comment says.
   *
   * @param commentId - Which comment.
   * @param viewerUserId - Who is asking. Only its author may.
   * @param body - What it says now.
   * @returns The comment as it now stands.
   * @throws {NotFoundError} If there is no such comment, it is not theirs, or
   *   it has been deleted.
   * @throws {ValidationError} If what they typed is not a comment, or refers to
   *   somebody they are blocked apart from.
   */
  async edit(commentId: string, viewerUserId: string, body: string): Promise<Comment> {
    const stored = await this.ownComment(commentId, viewerUserId);

    const refusal = checkCommentBody(body);

    if (refusal !== undefined) {
      throw new ValidationError(describeCommentBodyRefusal(refusal), { field: "body" });
    }

    const mentioned = await this.resolveMentions(body, viewerUserId);
    const at = this.clock();

    await withTransaction(this.dataSource, async (tx) => {
      await this.comments.edit(tx, commentId, body.trim(), at);
      // Re-read from what it now says, rather than accumulating what it once
      // said.
      await this.comments.clearMentions(tx, commentId);
      await this.comments.addMentions(tx, commentId, mentioned, at);
    });

    void stored;

    return this.read(commentId, viewerUserId);
  }

  /**
   * Take a comment back.
   *
   * @param commentId - Which comment.
   * @param viewerUserId - Who is asking. Only its author may.
   * @returns Nothing. The Moment is untouched: deleting a comment is not
   *   deleting what it was about (`comments.md:302`).
   * @throws {NotFoundError} If there is no such comment, it is not theirs, or
   *   it has already been deleted.
   */
  async remove(commentId: string, viewerUserId: string): Promise<void> {
    await this.ownComment(commentId, viewerUserId);

    await withTransaction(this.dataSource, async (tx) => {
      await this.comments.softDelete(tx, commentId, this.clock());
      await this.comments.clearMentions(tx, commentId);
    });
  }

  /**
   * Read a comment, proving the caller wrote it and that it still stands.
   *
   * @param commentId - Which comment.
   * @param viewerUserId - Who is asking.
   * @returns The stored comment.
   * @throws {NotFoundError} If there is no such comment, it belongs to somebody
   *   else, or it has been deleted. All three are one refusal: telling somebody
   *   a comment exists but is not theirs discloses that it exists.
   */
  private async ownComment(commentId: string, viewerUserId: string) {
    const stored = await this.comments.findById(commentId);

    if (
      stored === undefined ||
      stored.authorUserId !== viewerUserId ||
      stored.deletedAt !== null
    ) {
      throw new NotFoundError("No such comment");
    }

    await this.momentAccess.get(stored.momentId, viewerUserId);

    return stored;
  }

  /**
   * Set who may join a Moment's discussion.
   *
   * @param momentId - Which Moment.
   * @param authorUserId - Who is asking. Only its author may.
   * @param request - Which policy.
   * @returns Nothing. Closing a discussion leaves what was already said
   *   readable (`comments.md:427`); removing it would be a separate act.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   */
  async setPolicy(
    momentId: string,
    authorUserId: string,
    request: SetCommentPolicyRequest,
  ): Promise<void> {
    await this.momentAccess.getForAuthor(momentId, authorUserId);

    await withTransaction(this.dataSource, (tx) =>
      this.moments.setCommentPolicy(tx, momentId, request.policy, this.clock()),
    );
  }

  /**
   * React to a comment, or change how.
   *
   * @param commentId - Which comment.
   * @param viewerUserId - Who is reacting.
   * @param kind - Which of the four.
   * @returns The comment, with its counts as they now stand.
   * @throws {NotFoundError} If there is no such comment, it has been deleted,
   *   or the Moment it belongs to is not one this Viewer may see.
   * @throws {ValidationError} If a Block separates them from its author.
   */
  async react(commentId: string, viewerUserId: string, kind: ReactionKind): Promise<Comment> {
    const stored = await this.visibleComment(commentId, viewerUserId);

    if (await this.isBlocked(stored.authorUserId, viewerUserId)) {
      throw new ValidationError("This comment is not accepting reactions", { field: "kind" });
    }

    await withTransaction(this.dataSource, (tx) =>
      this.comments.react(tx, commentId, viewerUserId, kind, this.clock()),
    );

    return this.read(commentId, viewerUserId);
  }

  /**
   * Take a reaction to a comment back.
   *
   * @param commentId - Which comment.
   * @param viewerUserId - Who is withdrawing.
   * @returns The comment, with its counts as they now stand.
   * @throws {NotFoundError} If there is no such comment, or the Moment it
   *   belongs to is not one this Viewer may see.
   */
  async unreact(commentId: string, viewerUserId: string): Promise<Comment> {
    await this.visibleComment(commentId, viewerUserId);

    await withTransaction(this.dataSource, (tx) =>
      this.comments.unreact(tx, commentId, viewerUserId),
    );

    return this.read(commentId, viewerUserId);
  }

  /**
   * Read a comment that still stands, on a Moment this Viewer may see.
   *
   * @param commentId - Which comment.
   * @param viewerUserId - Who is asking.
   * @returns The stored comment.
   * @throws {NotFoundError} If there is no such comment, it has been deleted,
   *   or the Moment is not one they may see.
   */
  private async visibleComment(commentId: string, viewerUserId: string) {
    const stored = await this.comments.findById(commentId);

    if (stored === undefined || stored.deletedAt !== null) {
      throw new NotFoundError("No such comment");
    }

    await this.momentAccess.get(stored.momentId, viewerUserId);

    return stored;
  }

  /**
   * Whether a Block separates two people, whichever of them set it.
   *
   * @param oneUserId - One of them.
   * @param otherUserId - The other.
   * @returns Whether either has blocked the other.
   */
  private async isBlocked(oneUserId: string, otherUserId: string): Promise<boolean> {
    if (oneUserId === otherUserId) {
      return false;
    }

    const blocks = await this.follows.blocksBetween(oneUserId, otherUserId);

    return blocks.iBlockedThem || blocks.theyBlockedMe;
  }
}
