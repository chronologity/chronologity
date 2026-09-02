import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { User } from "../users/user.model.js";
import { Moment } from "./moment.model.js";

/**
 * The Comment tables.
 *
 * A Comment is not a Moment (`comments.md:58`). It is mutable conversation, and
 * when it was written says nothing about when the experience happened — a
 * discussion in 2029 about a photograph from 1988 leaves that photograph in
 * 1988.
 *
 * These describe tables the migrations own (ADR-099).
 */

/** Something somebody said about a Moment. */
@Entity("moment_comments")
@Index("moment_comments_author_idx", ["authorUserId"])
export class MomentComment {
  @PrimaryColumn("uuid", { name: "comment_id" })
  commentId!: string;

  @Column("uuid", { name: "moment_id" })
  momentId!: string;

  @Column("uuid", { name: "author_user_id" })
  authorUserId!: string;

  /**
   * The top-level Comment this belongs to, or null when it is one.
   *
   * What flattens presentation to a single visible level
   * (`comments.md:161`): replying to a reply joins that reply's thread rather
   * than nesting deeper, so a discussion cannot become a tree nobody can read
   * on a phone.
   */
  @Column("uuid", { name: "thread_comment_id", nullable: true })
  threadCommentId!: string | null;

  /**
   * Which Comment was actually addressed, where that differs from the thread.
   *
   * Retained because without it a reply aimed at one person in a busy thread
   * loses who it was answering.
   */
  @Column("uuid", { name: "in_reply_to_comment_id", nullable: true })
  inReplyToCommentId!: string | null;

  @Column("text")
  body!: string;

  /**
   * Its position in the conversation, and never rewritten.
   *
   * Editing must not move a Comment through the discussion
   * (`comments.md:271`), so ordering reads this and the edit time is separate.
   */
  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  /** Null until the visible text has changed after publication. */
  @Column("timestamptz", { name: "edited_at", nullable: true })
  editedAt!: Date | null;

  /**
   * Soft, so a tombstone can stand where replies still hang from it, and so
   * moderation retains what `comments.md:296` says it may need.
   */
  @Column("timestamptz", { name: "deleted_at", nullable: true })
  deletedAt!: Date | null;

  @ManyToOne(() => Moment)
  @JoinColumn({ name: "moment_id" })
  moment?: Moment;

  @ManyToOne(() => User)
  @JoinColumn({ name: "author_user_id" })
  author?: User;
}

/**
 * Who a Comment refers to in conversation.
 *
 * The resolved person, never the typed handle: `comments.md:503` requires a
 * mention to survive its target changing handle, which storing text could not
 * do.
 *
 * It says a Comment refers to somebody. It never asserts they were present for
 * the experience — that would be a tag on the Moment, which is a different
 * thing (`comments.md:489`).
 */
@Entity("comment_mentions")
@Index("comment_mentions_user_idx", ["userId"])
export class CommentMention {
  @PrimaryColumn("uuid", { name: "comment_id" })
  commentId!: string;

  @PrimaryColumn("uuid", { name: "user_id" })
  userId!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @ManyToOne(() => MomentComment)
  @JoinColumn({ name: "comment_id" })
  comment?: MomentComment;

  @ManyToOne(() => User)
  @JoinColumn({ name: "user_id" })
  user?: User;
}

/**
 * A response to something somebody said.
 *
 * Its own table rather than a target shared with `moment_reactions`, which is
 * keyed on a Moment. Two explicit relationships read better than one
 * polymorphic one, and each keeps real foreign keys.
 */
@Entity("comment_reactions")
@Index("comment_reactions_counting_idx", ["commentId", "kind"])
@Index("comment_reactions_user_idx", ["userId"])
export class CommentReaction {
  @PrimaryColumn("uuid", { name: "comment_id" })
  commentId!: string;

  @PrimaryColumn("uuid", { name: "user_id" })
  userId!: string;

  /** The same four a Moment takes, stored as names rather than glyphs. */
  @Column("text")
  kind!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @Column("timestamptz", { name: "updated_at" })
  updatedAt!: Date;

  @ManyToOne(() => MomentComment)
  @JoinColumn({ name: "comment_id" })
  comment?: MomentComment;

  @ManyToOne(() => User)
  @JoinColumn({ name: "user_id" })
  user?: User;
}
