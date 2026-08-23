import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { User } from "../users/user.model.js";
import { Moment } from "./moment.model.js";

/**
 * Who may see a restricted Moment.
 *
 * A list belonging to one Moment rather than a reusable group. `privacy.md:98`
 * asks that the access model stay "as simple as possible" and warns against
 * reproducing a matrix of social-network privacy controls; a shared group would
 * also mean that editing it silently changed the audience of every Moment
 * already pointing at it.
 *
 * This describes a table the migrations own (ADR-099).
 */

/** One person permitted to see one Moment. */
@Entity("moment_audience")
@Index("moment_audience_user_idx", ["userId", "momentId"])
export class MomentAudience {
  @PrimaryColumn("uuid", { name: "moment_id" })
  momentId!: string;

  @PrimaryColumn("uuid", { name: "user_id" })
  userId!: string;

  @Column("timestamptz", { name: "added_at" })
  addedAt!: Date;

  @ManyToOne(() => Moment)
  @JoinColumn({ name: "moment_id" })
  moment?: Moment;

  @ManyToOne(() => User)
  @JoinColumn({ name: "user_id" })
  user?: User;
}
