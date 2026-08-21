import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne, PrimaryColumn } from "typeorm";
import { User } from "../users/user.model.js";

/**
 * The authentication tables.
 *
 * An Identity is the means of signing in; it exists before account creation and
 * after deactivation, which is why it is not the same row as a User.
 *
 * These describe tables the migrations own (ADR-099). The DataSource runs with
 * `synchronize` off, so nothing here alters a column.
 */

/** Whoever is asking, proven. */
@Entity("identities")
export class Identity {
  @PrimaryColumn("uuid", { name: "identity_id" })
  identityId!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @OneToMany(() => IdentityEmail, (email) => email.identity)
  emails?: IdentityEmail[];

  @OneToOne(() => IdentityPassword, (password) => password.identity)
  password?: IdentityPassword;

  @OneToMany(() => Session, (session) => session.identity)
  sessions?: Session[];

  @OneToOne(() => User, (user) => user.identity)
  user?: User;
}

/**
 * An address claimed by an Identity.
 *
 * Keyed on the normalised form, which is what makes first sign-in safe under
 * concurrency: the unique constraint decides which of two simultaneous claims
 * wins, and the loser reads back the winner's Identity. Deciding that in
 * application code would let both win and split one person across two accounts.
 */
@Entity("identity_emails")
export class IdentityEmail {
  @PrimaryColumn("text", { name: "normalized_email" })
  normalizedEmail!: string;

  /** As typed, including capitalisation. */
  @Column("text")
  email!: string;

  @Index()
  @Column("uuid", { name: "identity_id" })
  identityId!: string;

  /**
   * Null until control of the address is proven. Registering does not prove it;
   * redeeming a link sent to it does. Recording an unproven address as verified
   * would let anyone claim someone else's by typing it.
   */
  @Column("timestamptz", { name: "verified_at", nullable: true })
  verifiedAt!: Date | null;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @ManyToOne(() => Identity, (identity) => identity.emails)
  @JoinColumn({ name: "identity_id" })
  identity?: Identity;
}

/**
 * An Identity's password, hashed.
 *
 * Optional, and absence is a valid state: magic link remains a way to sign in.
 */
@Entity("identity_passwords")
export class IdentityPassword {
  @PrimaryColumn("uuid", { name: "identity_id" })
  identityId!: string;

  /**
   * PHC format, which carries its own parameters, so the cost can be raised
   * later without invalidating what is already stored.
   */
  @Column("text", { name: "password_hash" })
  passwordHash!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @Column("timestamptz", { name: "updated_at" })
  updatedAt!: Date;

  @OneToOne(() => Identity, (identity) => identity.password)
  @JoinColumn({ name: "identity_id" })
  identity?: Identity;
}

/**
 * A signed-in device.
 *
 * This row is the authority for whether a request may authenticate (ADR-094).
 * Revocation is written synchronously in the request that causes it, so the
 * next read sees it — which is what makes reading the row safe rather than
 * lagging behind a stream.
 */
@Entity("sessions")
@Index("sessions_identity_id_idx", ["identityId", "createdAt"])
export class Session {
  @PrimaryColumn("uuid", { name: "session_id" })
  sessionId!: string;

  @Column("uuid", { name: "identity_id" })
  identityId!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @Column("timestamptz", { name: "expires_at" })
  expiresAt!: Date;

  @Column("timestamptz", { name: "last_refreshed_at", nullable: true })
  lastRefreshedAt!: Date | null;

  /**
   * Null while open. The first revocation wins: a later logout must not
   * overwrite evidence of a suspected theft.
   */
  @Column("timestamptz", { name: "revoked_at", nullable: true })
  revokedAt!: Date | null;

  @Column("text", { name: "revocation_reason", nullable: true })
  revocationReason!: string | null;

  @Column("text", { name: "client_kind", nullable: true })
  clientKind!: string | null;

  /**
   * The current refresh credential. Rotation requires the presented hash to
   * still match this one, which is what makes reuse detectable.
   */
  @Column("text", { name: "refresh_token_hash", nullable: true })
  refreshTokenHash!: string | null;

  @Column("int", { name: "refresh_generation", default: 0 })
  refreshGeneration!: number;

  @ManyToOne(() => Identity, (identity) => identity.sessions)
  @JoinColumn({ name: "identity_id" })
  identity?: Identity;
}

/**
 * A single-use, time-limited login link.
 *
 * Stored only as a hash and usable exactly once. Purpose is bound in and
 * checked on redemption, so a link sent to verify an address cannot be redeemed
 * to set a password.
 */
@Entity("magic_link_tokens")
export class MagicLinkToken {
  @PrimaryColumn("text", { name: "token_hash" })
  tokenHash!: string;

  /**
   * Issued for addresses with no Identity on purpose, so this is not a
   * reference to one.
   */
  @Column("text")
  email!: string;

  @Column("text")
  purpose!: string;

  @Index()
  @Column("timestamptz", { name: "expires_at" })
  expiresAt!: Date;

  @Column("timestamptz", { name: "consumed_at", nullable: true })
  consumedAt!: Date | null;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;
}

/**
 * Who signed in, from where, and whether it was refused.
 *
 * Kept apart from logs (ADR-047): logs are operational and rotate, this is
 * evidence that has to survive. Deliberately carries no foreign key, so it
 * outlives what it describes without either destroying evidence on deletion or
 * preventing deletion entirely.
 */
@Entity("auth_audit_events")
@Index("auth_audit_events_identity_idx", ["identityId", "occurredAt"])
export class AuthAuditEvent {
  @PrimaryColumn("uuid")
  id!: string;

  @Column("timestamptz", { name: "occurred_at" })
  occurredAt!: Date;

  @Column("text", { name: "event_type" })
  eventType!: string;

  @Column("uuid", { name: "identity_id", nullable: true })
  identityId!: string | null;

  @Column("uuid", { name: "session_id", nullable: true })
  sessionId!: string | null;

  @Column("text")
  outcome!: string;

  @Column("text", { nullable: true })
  reason!: string | null;

  @Column("text", { name: "trace_id", nullable: true })
  traceId!: string | null;

  /** Client-safe context. Never a token, link, or address. */
  /**
   * Declared as `object` rather than `Record<string, unknown>`: the driver
   * serialises whatever it is given, and an open index signature does not
   * satisfy the query builder's deep-partial of the column type.
   */
  @Column("jsonb", { nullable: true })
  context!: object | null;
}
