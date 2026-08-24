import { Column, Entity, JoinColumn, Index, OneToOne, PrimaryColumn } from "typeorm";
import { Identity } from "./identity.model.js";

/**
 * A phone number as a way to sign in.
 *
 * An email address remains what establishes an account (`users.md:843`), and
 * this is a second way in rather than a replacement. A number can be lost or
 * reassigned by a carrier, and an account whose only key is a number is an
 * account that can be lost or taken along with it.
 *
 * These describe tables the migrations own (ADR-099).
 */

/** The one number an Identity holds. */
@Entity("identity_phones")
export class IdentityPhone {
  /**
   * E.164, the one spelling of a number there is.
   *
   * Primary key, which is what makes a first claim safe under concurrency: the
   * constraint decides which of two simultaneous claims wins, and the loser
   * finds the number already held. Deciding that in application code would let
   * both win.
   */
  @PrimaryColumn("text", { name: "normalized_phone" })
  normalizedPhone!: string;

  /** As typed, including whatever spacing somebody used. */
  @Column("text")
  phone!: string;

  /** Unique: one account holds one number, and replacing it is deliberate. */
  @Index({ unique: true })
  @Column("uuid", { name: "identity_id" })
  identityId!: string;

  /**
   * Null until control of the number is proven by a code sent to it. Claiming
   * does not prove it, exactly as registering does not prove an address.
   */
  @Column("timestamptz", { name: "verified_at", nullable: true })
  verifiedAt!: Date | null;

  /**
   * When it was last used to sign in, which is what dormancy is measured from.
   *
   * The whole defence against recycled numbers rests on this column. A carrier
   * only reassigns a number after its holder stops using it, so a number that
   * has gone quiet is exactly the one that may belong to somebody else now.
   */
  @Column("timestamptz", { name: "last_signed_in_at", nullable: true })
  lastSignedInAt!: Date | null;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @OneToOne(() => Identity)
  @JoinColumn({ name: "identity_id" })
  identity?: Identity;
}

/**
 * A code sent to a number, and the guesses made against it.
 *
 * Deliberately not `magic_link_tokens`. That holds 32 random bytes, which
 * cannot be guessed; this holds six digits somebody types, which is one in a
 * million. A guessable secret needs an attempt counter and a much shorter life,
 * and storing the two kinds together would invite treating them alike.
 */
@Entity("phone_sign_in_codes")
@Index("phone_sign_in_codes_phone_idx", ["normalizedPhone", "createdAt"])
export class PhoneSignInCode {
  /** SHA-256 of the code. The code itself is never stored. */
  @PrimaryColumn("text", { name: "code_hash" })
  codeHash!: string;

  /**
   * Which number it was sent to.
   *
   * Redemption requires this as well as the code. A six-digit secret is short
   * enough that binding it to one telephone is what stops a guessed code
   * opening somebody else's account.
   */
  @Column("text", { name: "normalized_phone" })
  normalizedPhone!: string;

  @Column("text")
  purpose!: string;

  @Column("timestamptz", { name: "expires_at" })
  expiresAt!: Date;

  @Column("timestamptz", { name: "consumed_at", nullable: true })
  consumedAt!: Date | null;

  /** Wrong guesses. Enough of them spend the code, right one or not. */
  @Column("int")
  attempts!: number;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;
}
