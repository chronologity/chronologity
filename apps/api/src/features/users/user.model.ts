import { Column, Entity, Index, JoinColumn, OneToOne, PrimaryColumn } from "typeorm";
import { Identity } from "../authentication/identity.model.js";

/**
 * The User tables.
 *
 * Four of them, and the separation is deliberate rather than incidental.
 * `Handle` is keyed on the normalised handle so the database decides who wins a
 * race for a name; `RestrictedData` holds a birthdate so that no query written
 * against `User` can return it by accident, and erasing it is one targeted
 * delete.
 *
 * These describe tables the migrations own (ADR-099). Nothing here creates or
 * alters a column: the DataSource runs with `synchronize` off, so a mismatch
 * between this file and the database is a mistake to fix rather than a change
 * to apply.
 */

/**
 * Someone with an account.
 *
 * Separate from the Identity that signs in: an Identity proves who is asking, a
 * User is who they are to everybody else. Deactivating one leaves the other.
 */
@Entity("users")
export class User {
  @PrimaryColumn("uuid", { name: "user_id" })
  userId!: string;

  @Index("users_identity_idx")
  @Column("uuid", { name: "identity_id", unique: true })
  identityId!: string;

  /** As currently written, including capitalisation. `Handle` decides who holds it. */
  @Column("text")
  handle!: string;

  @Column("text", { name: "display_name" })
  displayName!: string;

  @Column("text", { nullable: true })
  biography!: string | null;

  /**
   * `active`, `deactivated`, or `suspended`.
   *
   * Constrained to these three by the database — which became true when
   * suspension arrived. The column carried no check constraint before that, so
   * this file was the only thing asserting the vocabulary and nothing enforced
   * it.
   *
   * Deactivation is the person's own decision and suspension is not, which is
   * why they are separate values rather than one "inactive": moderation must
   * never quietly overwrite somebody's own choice, and reinstating an account
   * must not undo it.
   */
  @Column("text", { default: "active" })
  status!: "active" | "deactivated" | "suspended";

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @Column("timestamptz", { name: "updated_at" })
  updatedAt!: Date;

  @OneToOne(() => Identity, (identity) => identity.user)
  @JoinColumn({ name: "identity_id" })
  identity?: Identity;

  @OneToOne(() => Preferences, (preferences) => preferences.user)
  preferences?: Preferences;

  @OneToOne(() => Handle, (held) => held.user)
  heldHandle?: Handle;

  @OneToOne(() => RestrictedData, (restricted) => restricted.user)
  restricted?: RestrictedData;
}

/**
 * A handle a User holds, or held.
 *
 * Keyed on the normalised form, so two people claiming `@richard` at the same
 * moment both attempt the insert and the database picks one. A released handle
 * keeps its row: the cooldown runs from `releasedAt`, and a former handle must
 * not resolve to whoever used to have it.
 *
 * A partial unique index on `userId` where `releasedAt IS NULL` is what stops a
 * User holding two at once. It lives in the migration, because a partial index
 * is not something this file can express.
 */
@Entity("user_handles")
export class Handle {
  @PrimaryColumn("text", { name: "normalized_handle" })
  normalizedHandle!: string;

  /** As chosen, including capitalisation. */
  @Column("text")
  handle!: string;

  @Index("user_handles_user_idx")
  @Column("uuid", { name: "user_id" })
  userId!: string;

  @Column("timestamptz", { name: "assigned_at" })
  assignedAt!: Date;

  /** Null while held. Set when given up, which starts the cooldown. */
  @Column("timestamptz", { name: "released_at", nullable: true })
  releasedAt!: Date | null;

  @OneToOne(() => User, (user) => user.heldHandle)
  @JoinColumn({ name: "user_id" })
  user?: User;
}

/**
 * How someone wants the application to behave.
 *
 * Written with the account rather than created on first change, so reading it
 * never has to decide what a missing row means.
 */
@Entity("user_preferences")
export class Preferences {
  @PrimaryColumn("uuid", { name: "user_id" })
  userId!: string;

  /** Autoplay is on with sound by default, and can be turned off. */
  @Column("boolean", { name: "autoplay_videos", default: true })
  autoplayVideos!: boolean;

  @Column("boolean", { name: "autoplay_sound", default: true })
  autoplaySound!: boolean;

  @Column("text", { nullable: true })
  locale!: string | null;

  @Column("text", { name: "time_zone", nullable: true })
  timeZone!: string | null;

  @Column("boolean", { name: "reduced_motion", default: false })
  reducedMotion!: boolean;

  /**
   * Whether this account has to approve who follows it.
   *
   * Deliberately independent of anything else. `social-graph.md` asks for both
   * open and approval-based following "even if the exact account-level privacy
   * model is refined separately", so this is one setting with one meaning
   * rather than a privacy model invented ahead of its specification.
   */
  @Column("boolean", { name: "requires_follow_approval", default: false })
  requiresFollowApproval!: boolean;

  @Column("timestamptz", { name: "updated_at" })
  updatedAt!: Date;

  @OneToOne(() => User, (user) => user.preferences)
  @JoinColumn({ name: "user_id" })
  user?: User;
}

/**
 * A date of birth, kept apart from everything else about a User.
 *
 * Its own table so that nothing written against `User` can return it by
 * accident, and so erasing it is one targeted delete rather than a column
 * update somewhere in a wider row.
 */
@Entity("user_restricted_data")
export class RestrictedData {
  @PrimaryColumn("uuid", { name: "user_id" })
  userId!: string;

  @Column("date", { name: "date_of_birth" })
  dateOfBirth!: string;

  /**
   * The threshold in force when the account was created. Stored because the
   * threshold is configuration, and without it nobody can say afterwards which
   * rule an account was admitted under.
   */
  @Column("int", { name: "minimum_age_at_creation" })
  minimumAgeAtCreation!: number;

  @Column("timestamptz", { name: "recorded_at" })
  recordedAt!: Date;

  @OneToOne(() => User, (user) => user.restricted)
  @JoinColumn({ name: "user_id" })
  user?: User;
}
