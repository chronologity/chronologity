import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { User } from "../users/user.model.js";

/**
 * The Saved View tables.
 *
 * These describe tables the migrations own (ADR-099).
 */

/**
 * A perspective on history somebody kept.
 *
 * What is stored is a View Specification, never a list of Moments — so
 * reopening it derives current history rather than replaying an old answer, and
 * a view of "this year" means this year whenever it is opened.
 */
@Entity("saved_views")
@Index("saved_views_user_idx", ["userId", "createdAt", "savedViewId"])
export class SavedViewRow {
  @PrimaryColumn("uuid", { name: "saved_view_id" })
  savedViewId!: string;

  @Column("uuid", { name: "user_id" })
  userId!: string;

  /** What they called it. Their words about their own history. */
  @Column("text")
  title!: string;

  /**
   * The specification, as JSON.
   *
   * Read back through the contract rather than trusted: it was written by an
   * older version of this system and may be older than the reader.
   */
  @Column("jsonb")
  specification!: Record<string, unknown>;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @Column("timestamptz", { name: "updated_at" })
  updatedAt!: Date;

  /**
   * When its owner last opened it.
   *
   * Null until they do. Authoritative rather than derived — nothing could
   * recompute when somebody looked at something — which is why it lives here
   * and the count of what has arrived since lives in its own table.
   */
  @Column("timestamptz", { name: "last_visited_at", nullable: true })
  lastVisitedAt!: Date | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: "user_id" })
  user?: User;
}

/**
 * A link that opens somebody else's view.
 *
 * Carries what it may disclose, because one view may be shared twice on
 * different terms. It never carries access: opening it derives for whoever
 * opened it.
 */
@Entity("saved_view_shares")
@Index("saved_view_shares_view_idx", ["savedViewId", "createdAt"])
export class SavedViewShareRow {
  @PrimaryColumn("uuid", { name: "share_id" })
  shareId!: string;

  /** The capability. The only thing between a forwarded link and the view. */
  @Column("text")
  token!: string;

  @Column("uuid", { name: "saved_view_id" })
  savedViewId!: string;

  @Column("boolean", { name: "reveals_title", default: false })
  revealsTitle!: boolean;

  @Column("boolean", { name: "reveals_owner", default: false })
  revealsOwner!: boolean;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  /** When the sender withdrew it. Null while it still opens. */
  @Column("timestamptz", { name: "revoked_at", nullable: true })
  revokedAt!: Date | null;

  @ManyToOne(() => SavedViewRow)
  @JoinColumn({ name: "saved_view_id" })
  savedView?: SavedViewRow;
}
