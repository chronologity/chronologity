import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { User } from "../users/user.model.js";

/**
 * The moderation tables.
 *
 * These describe tables the migrations own (ADR-099). The DataSource runs with
 * `synchronize` off, so nothing here alters a column.
 */

/**
 * What Chronologity is currently doing about one thing.
 *
 * Absent means `allowed`. The overwhelming majority of everything is
 * unmoderated, and a row per Moment would be a table the size of the platform
 * saying nothing.
 */
@Entity("moderation_states")
export class ModerationStateRow {
  @PrimaryColumn("text", { name: "subject_type" })
  subjectType!: string;

  @PrimaryColumn("uuid", { name: "subject_id" })
  subjectId!: string;

  /** One of the seven of `moderation.md:159`. Constrained by the database. */
  @Column("text")
  state!: string;

  /**
   * Why, in a moderator's words.
   *
   * Not nullable: `moderation.md:680` expects the person affected to be told
   * the reason, and a decision recorded without one cannot be explained later
   * or defended in an appeal.
   */
  @Column("text")
  reason!: string;

  /** Null where automation set it, which nothing does — triage sets no state. */
  @Column("uuid", { name: "decided_by_user_id", nullable: true })
  decidedByUserId!: string | null;

  @Column("timestamptz", { name: "decided_at" })
  decidedAt!: Date;
}

/**
 * Every decision ever made, and every one refused.
 *
 * Append-only, and this feature's audit log. `moderation.md:835` requires
 * provenance; a current-state table can say what is true now and never who made
 * it true or why.
 *
 * Kept apart from `authorization_audit_events` and `auth_audit_events` rather
 * than joining them: those are scoped to role grants and to sessions, and a
 * single audit table spanning three domains would make every query about one of
 * them filter through the other two.
 */
@Entity("moderation_actions")
@Index("moderation_actions_affected_idx", ["affectedUserId", "occurredAt"])
export class ModerationAction {
  @PrimaryColumn("uuid", { name: "action_id" })
  actionId!: string;

  @Column("text", { name: "subject_type" })
  subjectType!: string;

  @Column("uuid", { name: "subject_id" })
  subjectId!: string;

  /** Null for a suspension, which is an account status rather than a state. */
  @Column("text", { nullable: true })
  state!: string | null;

  /**
   * Who this was done to.
   *
   * Carried separately from the subject so that moderating somebody's Moment
   * can be found when they ask what was done to them, without joining through
   * every content table to discover who owned what.
   */
  @Column("uuid", { name: "affected_user_id", nullable: true })
  affectedUserId!: string | null;

  /** Null where no User was acting. */
  @Column("uuid", { name: "actor_user_id", nullable: true })
  actorUserId!: string | null;

  /** `human` or `automated`. Nothing automated writes here yet. */
  @Column("text", { name: "actor_kind" })
  actorKind!: string;

  /** `success` or `failure`. Refused attempts are recorded, not discarded. */
  @Column("text")
  outcome!: string;

  @Column("text")
  reason!: string;

  @Column("timestamptz", { name: "occurred_at" })
  occurredAt!: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "affected_user_id" })
  affected?: User;
}

/** Somebody saying something breaks the rules. */
@Entity("moderation_reports")
@Index("moderation_reports_reporter_idx", ["reporterUserId", "createdAt"])
export class ModerationReportRow {
  @PrimaryColumn("uuid", { name: "report_id" })
  reportId!: string;

  @Column("text", { name: "subject_type" })
  subjectType!: string;

  @Column("uuid", { name: "subject_id" })
  subjectId!: string;

  /**
   * Never disclosed to the subject.
   *
   * `moderation.md:541` expects people to report conduct they believe breaks
   * the rules, and somebody who fears being identified for it will not.
   */
  @Column("uuid", { name: "reporter_user_id" })
  reporterUserId!: string;

  @Column("text")
  reason!: string;

  @Column("text", { nullable: true })
  detail!: string | null;

  @Column("text")
  status!: string;

  /**
   * Ordering only.
   *
   * `moderation.md:614`: report volume may affect review prioritization and
   * must never establish that content violates policy. Nothing reads this to
   * decide an outcome.
   */
  @Column("text")
  priority!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @Column("timestamptz", { name: "resolved_at", nullable: true })
  resolvedAt!: Date | null;
}

/**
 * Somebody saying a Moment is wrong about history.
 *
 * Its own table rather than a reason code in the one above
 * (`moderation.md:600`), and no moderation state is reachable from it: a wrong
 * date is something to fix, not something to enforce against.
 */
@Entity("accuracy_reports")
@Index("accuracy_reports_reporter_idx", ["reporterUserId", "createdAt"])
export class AccuracyReportRow {
  @PrimaryColumn("uuid", { name: "report_id" })
  reportId!: string;

  @Column("uuid", { name: "moment_id" })
  momentId!: string;

  @Column("uuid", { name: "reporter_user_id" })
  reporterUserId!: string;

  @Column("text")
  reason!: string;

  /** Required, unlike a safety report's: "this is wrong" gives a reviewer nothing. */
  @Column("text")
  detail!: string;

  @Column("text")
  status!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @Column("timestamptz", { name: "resolved_at", nullable: true })
  resolvedAt!: Date | null;
}

/** Contesting a decision. */
@Entity("moderation_appeals")
@Index("moderation_appeals_appellant_idx", ["appellantUserId", "createdAt"])
export class ModerationAppeal {
  @PrimaryColumn("uuid", { name: "appeal_id" })
  appealId!: string;

  @Column("uuid", { name: "action_id" })
  actionId!: string;

  @Column("uuid", { name: "appellant_user_id" })
  appellantUserId!: string;

  @Column("text")
  statement!: string;

  /** `open` or `decided`. A database constraint keeps this and `outcome` agreeing. */
  @Column("text")
  status!: string;

  @Column("text", { nullable: true })
  outcome!: string | null;

  @Column("text", { nullable: true })
  resolution!: string | null;

  @Column("uuid", { name: "decided_by_user_id", nullable: true })
  decidedByUserId!: string | null;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @Column("timestamptz", { name: "decided_at", nullable: true })
  decidedAt!: Date | null;
}
