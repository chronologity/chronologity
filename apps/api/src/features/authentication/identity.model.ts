import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne, PrimaryColumn } from "typeorm";
import { Session } from "./session.model.js";
import { User } from "../users/user.model.js";

/**
 * Who someone is, and how they prove it.
 *
 * An Identity is the means of signing in; it exists before account creation and
 * after deactivation, which is why it is not the same row as a User.
 *
 * What a signed-in device is, and what is recorded about signing in, lives in
 * `session.model.ts`. The two halves reference each other, and the split is by
 * concern rather than by table: this file answers "who", that one answers "for
 * how long, and what happened".
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
