import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { User } from "../users/user.model.js";
import { Moment } from "./moment.model.js";

/**
 * An explicit claim connecting two Moments.
 *
 * A row rather than a list of identifiers on a Moment, and the reason is the
 * rule the whole feature rests on (`causality.md:103`): Chronologity knows only
 * that one Moment preceded another, never that one caused another. A
 * relationship is therefore something somebody said, and a claim needs
 * somewhere to record who said it, what they meant, and which way it runs.
 *
 * It also keeps a claim about your Moment and mine from being written into
 * either of our rows.
 *
 * This describes a table the migrations own (ADR-099).
 */
@Entity("moment_relationships")
@Index("moment_relationships_source_idx", ["sourceMomentId", "createdAt"])
@Index("moment_relationships_target_idx", ["targetMomentId", "createdAt"])
export class MomentRelationship {
  @PrimaryColumn("uuid", { name: "relationship_id" })
  relationshipId!: string;

  @Column("uuid", { name: "source_moment_id" })
  sourceMomentId!: string;

  @Column("uuid", { name: "target_moment_id" })
  targetMomentId!: string;

  /**
   * What is being claimed: `led_to`, `contributed_to`, `related_to`,
   * `alternate_perspective`, or `contradicts`.
   *
   * Only the first two are causal, and only they carry a temporal rule. The
   * database constraint keeps the five honest.
   */
  @Column("text")
  kind!: string;

  /** `asserted`, `derived`, or `suggested`. Only the first is producible. */
  @Column("text")
  origin!: string;

  /**
   * Whose perspective this is.
   *
   * Stored rather than inferred from either Moment's author, because one end
   * may belong to somebody else and `causality.md:520` asks that the product
   * preserve whose reading of history a claim represents.
   */
  @Column("uuid", { name: "asserted_by_user_id" })
  assertedByUserId!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @ManyToOne(() => Moment)
  @JoinColumn({ name: "source_moment_id" })
  source?: Moment;

  @ManyToOne(() => Moment)
  @JoinColumn({ name: "target_moment_id" })
  target?: Moment;

  @ManyToOne(() => User)
  @JoinColumn({ name: "asserted_by_user_id" })
  assertedBy?: User;
}
