import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Moment } from "../moments/moment.model.js";
import { User } from "../users/user.model.js";

/**
 * The participation tables.
 *
 * These describe tables the migrations own (ADR-099).
 */

/**
 * One person's participation in one Moment.
 *
 * There is one row per `(moment_id, user_id)` and there is only ever one, for
 * the life of the Moment. A rejection or a withdrawal leaves the row standing,
 * and the unique constraint on that pair is what stops the creator asking
 * again — permanence is a property of the schema rather than a rule the service
 * has to remember.
 *
 * There is no `proposedByUserId`. Only a Moment's creator may propose, so it
 * would always be `Moment.authorUserId`, and a copy the database cannot keep in
 * step is a copy that will eventually disagree.
 */
@Entity("moment_participations")
@Index("moment_participations_user_idx", ["userId", "proposedAt", "participationId"])
export class MomentParticipation {
  @PrimaryColumn("uuid", { name: "participation_id" })
  participationId!: string;

  @Column("uuid", { name: "moment_id" })
  momentId!: string;

  /** Who is said to have been there, and the only person who may answer. */
  @Column("uuid", { name: "user_id" })
  userId!: string;

  /**
   * How far it has got.
   *
   * A plain string rather than a union, as `FollowRequest.status` is: the
   * database owns the vocabulary through a check constraint, and a TypeScript
   * union here would be a second declaration of it that could drift.
   */
  @Column("text")
  status!: string;

  @Column("timestamptz", { name: "proposed_at" })
  proposedAt!: Date;

  /** When it was answered. Null while it is still a question. */
  @Column("timestamptz", { name: "resolved_at", nullable: true })
  resolvedAt!: Date | null;

  @ManyToOne(() => Moment)
  @JoinColumn({ name: "moment_id" })
  moment?: Moment;

  @ManyToOne(() => User)
  @JoinColumn({ name: "user_id" })
  user?: User;
}

/**
 * Somebody who may not propose participation to this person.
 *
 * Weaker than a Block and separate from one. A Block severs interaction in both
 * directions and covers the severe case; this covers the ordinary one, where a
 * person is not blocked but is not welcome to keep asking either.
 */
@Entity("participation_refusals")
@Index("participation_refusals_refusing_idx", [
  "refusingUserId",
  "createdAt",
  "refusedUserId",
])
export class ParticipationRefusal {
  @PrimaryColumn("uuid", { name: "refusing_user_id" })
  refusingUserId!: string;

  @PrimaryColumn("uuid", { name: "refused_user_id" })
  refusedUserId!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "refusing_user_id" })
  refusing?: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: "refused_user_id" })
  refused?: User;
}
