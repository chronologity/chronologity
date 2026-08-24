import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { User } from "../users/user.model.js";
import { Moment } from "./moment.model.js";

/**
 * A lightweight response to a Moment.
 *
 * Social activity rather than historical occurrence (`reactions.md:43`): a
 * Reaction says something about whoever left it and nothing about whether the
 * Moment happened as represented.
 *
 * This describes a table the migrations own (ADR-099).
 */
@Entity("moment_reactions")
@Index("moment_reactions_counting_idx", ["momentId", "kind"])
@Index("moment_reactions_user_idx", ["userId"])
export class MomentReaction {
  /**
   * The pair is the key, and the key is the rule.
   *
   * `reactions.md:111` requires at most one active Reaction per person per
   * Moment. Enforcing that here makes changing a Reaction an update rather than
   * a second row, so reaction inflation is impossible by construction.
   */
  @PrimaryColumn("uuid", { name: "moment_id" })
  momentId!: string;

  @PrimaryColumn("uuid", { name: "user_id" })
  userId!: string;

  /**
   * `loved`, `amused`, `astonished`, or `saddened`.
   *
   * A name, never a glyph. Changing the artwork a client renders must not
   * silently transform what years of stored history meant
   * (`reactions.md:101`).
   */
  @Column("text")
  kind!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @Column("timestamptz", { name: "updated_at" })
  updatedAt!: Date;

  @ManyToOne(() => Moment)
  @JoinColumn({ name: "moment_id" })
  moment?: Moment;

  @ManyToOne(() => User)
  @JoinColumn({ name: "user_id" })
  user?: User;
}
