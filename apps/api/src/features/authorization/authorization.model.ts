import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { User } from "../users/user.model.js";

/**
 * The authorization tables.
 *
 * Two of them, deliberately. `RoleAssignment` is what a privileged request is
 * checked against and holds only what is true now; the audit table is where
 * "who was made an administrator, by whom, and why" survives. Merging them
 * would mean either a table that grows without bound on the hot path of every
 * privileged request, or evidence that gets deleted when a role is revoked.
 *
 * Only elevated roles are stored. `user` is what being a User means.
 */

/** An elevated role a User holds. */
@Entity("authorization_user_roles")
export class RoleAssignment {
  @PrimaryColumn("uuid", { name: "user_id" })
  userId!: string;

  /** `administrator` or `moderator`. Constrained by the database. */
  @PrimaryColumn("text")
  role!: string;

  @Column("timestamptz", { name: "assigned_at" })
  assignedAt!: Date;

  /**
   * Null where the grant came from the command line and no User was acting.
   * Nullable rather than required so a role change survives the departure of
   * whoever made it: the attribution goes, the fact stays.
   */
  @Column("uuid", { name: "assigned_by", nullable: true })
  assignedBy!: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: "user_id" })
  user?: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: "assigned_by" })
  grantedBy?: User;
}

/**
 * Evidence for a role change, including one that was refused.
 *
 * Separate from the assignment so that revoking a role does not delete the
 * record of it having been held.
 */
@Entity("authorization_audit_events")
@Index("authorization_audit_subject_idx", ["subjectUserId", "occurredAt"])
export class AuthorizationAuditEvent {
  @PrimaryColumn("uuid")
  id!: string;

  @Column("timestamptz", { name: "occurred_at" })
  occurredAt!: Date;

  @Column("text", { name: "event_type" })
  eventType!: string;

  /** Null where no User was acting. */
  @Column("uuid", { name: "actor_user_id", nullable: true })
  actorUserId!: string | null;

  @Column("uuid", { name: "subject_user_id" })
  subjectUserId!: string;

  @Column("text")
  role!: string;

  @Column("text")
  outcome!: string;

  @Column("text", { nullable: true })
  reason!: string | null;

  @Column("text", { name: "trace_id", nullable: true })
  traceId!: string | null;

  /**
   * Declared as `object` rather than `Record<string, unknown>`: the driver
   * serialises whatever it is given, and an open index signature does not
   * satisfy the query builder's deep-partial of the column type.
   */
  @Column("jsonb", { nullable: true })
  context!: object | null;
}
