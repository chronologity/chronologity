import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { User } from "../users/user.model.js";

/**
 * The blocking table.
 *
 * Its own entity rather than a flag on a Follow, which `social-graph.md`
 * requires: "Blocking should be designed as an explicit relationship state, not
 * as a specialized Follow flag." A block outlives whatever it severs and exists
 * whether or not there was ever a relationship there.
 *
 * This describes a table the migrations own (ADR-099).
 */

/**
 * One person blocking another.
 *
 * Directional as an action, and its consequences reach both ways: when A blocks
 * B, neither may follow the other and any request between them is settled.
 *
 * Blocking is not historical erasure (`social-graph.md:257`). A block made in
 * 2026 does not mean somebody was absent from a Moment recorded in 2024; it
 * changes what the two may do from here.
 */
@Entity("user_blocks")
@Index("user_blocks_blocker_idx", ["blockerUserId", "createdAt", "blockedUserId"])
@Index("user_blocks_blocked_idx", ["blockedUserId"])
export class UserBlock {
  @PrimaryColumn("uuid", { name: "blocker_user_id" })
  blockerUserId!: string;

  @PrimaryColumn("uuid", { name: "blocked_user_id" })
  blockedUserId!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "blocker_user_id" })
  blocker?: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: "blocked_user_id" })
  blocked?: User;
}
