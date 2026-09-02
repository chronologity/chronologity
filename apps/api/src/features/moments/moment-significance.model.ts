import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { User } from "../users/user.model.js";
import { Moment } from "./moment.model.js";

/**
 * The significance tables.
 *
 * Why a Moment matters within the history being examined — never how much
 * attention it received. Nothing here is fed by a reaction, a comment, or a
 * view, and invariant 19 requires that it never be.
 *
 * These describe tables the migrations own (ADR-099).
 */

/**
 * Somebody saying a Moment matters to them.
 *
 * The one signal that cannot be derived. Invariant 11: personal significance
 * must be able to exist without social engagement or graph-derived importance,
 * because a photograph with nothing attached to it may still be the most
 * important Moment in a person's life.
 *
 * Private, always. No read anywhere returns anybody else's mark.
 */
@Entity("moment_personal_significance")
@Index("moment_personal_significance_user_idx", ["userId", "markedAt"])
export class MomentPersonalSignificance {
  @PrimaryColumn("uuid", { name: "moment_id" })
  momentId!: string;

  @PrimaryColumn("uuid", { name: "user_id" })
  userId!: string;

  @Column("timestamptz", { name: "marked_at" })
  markedAt!: Date;

  @ManyToOne(() => Moment)
  @JoinColumn({ name: "moment_id" })
  moment?: Moment;

  @ManyToOne(() => User)
  @JoinColumn({ name: "user_id" })
  user?: User;
}

/**
 * Derived significance, per Moment, per scope, per dimension.
 *
 * Keyed on scope because `Significance(Moment)` is the wrong model: a family's
 * first photograph after immigrating may be among the most consequential
 * Moments in that family's history and globally unremarkable, and one value per
 * Moment could not hold both.
 */
@Entity("moment_significance")
@Index("moment_significance_staleness_idx", ["computedAt"])
@Index("moment_significance_moment_idx", ["momentId", "dimension"])
export class MomentSignificance {
  @PrimaryColumn("uuid", { name: "moment_id" })
  momentId!: string;

  /** `person`, `real_world_event`, `location`, or `global`. */
  @PrimaryColumn("text", { name: "scope_type" })
  scopeType!: string;

  /** Zero-UUID for the global scope, so the key stays uniform rather than nullable. */
  @PrimaryColumn("uuid", { name: "scope_id" })
  scopeId!: string;

  @PrimaryColumn("text")
  dimension!: string;

  @Column("int")
  value!: number;

  /**
   * What this dimension scored the first time it was ever assessed.
   *
   * What makes retrospective significance observable: later history changing
   * the reading of an earlier Moment can only be seen by remembering where that
   * Moment started.
   */
  @Column("int", { name: "baseline_value" })
  baselineValue!: number;

  /**
   * `human`, `graph`, `rule`, or `ai`.
   *
   * Kept so that an explicit human attribution is never mistaken for an
   * inference as the system grows more sophisticated. Nothing produces `ai`.
   */
  @Column("text")
  provenance!: string;

  /** So algorithm evolution can be told from historical change. */
  @Column("text", { name: "algorithm_version" })
  algorithmVersion!: string;

  @Column("timestamptz", { name: "computed_at" })
  computedAt!: Date;

  @ManyToOne(() => Moment)
  @JoinColumn({ name: "moment_id" })
  moment?: Moment;
}
