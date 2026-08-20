import type pg from "pg";
import type { Transaction } from "../../lib/database/transaction.js";
import { generateId } from "../../lib/ids/generate-id.js";
import { normalizeEmail } from "./authentication.policy.js";

/**
 * Where identities, their addresses, and their credentials are stored.
 *
 * PostgreSQL is the authority (ADR-092). `identity_emails` in particular is
 * what makes first sign-in safe under concurrency: its unique constraint
 * decides which of two simultaneous first sign-ins for the same address wins,
 * and the loser reads back the winner's Identity. Deciding that in application
 * code — read, then create if absent — would let both win and split one person
 * across two accounts.
 *
 * Reads take the pool and writes take a transaction, except where a read is
 * part of a decision the same transaction is about to write.
 */

export interface ResolvedIdentity {
  readonly identityId: string;
  /** True when this call created the claim. */
  readonly created: boolean;
}

/** Reads and writes identities, their addresses, and their passwords. */
export class IdentityRepository {
  /**
   * Build the Identity repository.
   *
   * @param pool - Used for reads that stand alone.
   */
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Find the Identity owning an address, claiming it if unclaimed.
   *
   * @param tx - The caller's transaction. The unique constraint decides the
   *   winner when two first sign-ins race, which is why this must not be split
   *   into a read and a later write.
   * @param input - The address, the current instant, and whether control of it
   *   has actually been proven. Redeeming a link proves it; registering with a
   *   password does not, and recording an unproven address as verified would
   *   let anyone claim someone else's by typing it.
   * @returns The owning Identity, and whether this call created the claim.
   * @throws {Error} If the conflicting row disappears between the insert and
   *   the read that follows it. Failing is correct: guessing an Identity here
   *   would attach a Session to the wrong account.
   */
  async resolveForEmail(
    tx: Transaction,
    input: { email: string; now: Date; verified?: boolean },
  ): Promise<ResolvedIdentity> {
    const normalizedEmail = normalizeEmail(input.email);
    const identityId = generateId();

    // The Identity first, because the address references it. Speculative: this
    // call may turn out to have lost the claim below, in which case the row is
    // removed again before the transaction ends.
    await tx.query(`INSERT INTO identities (identity_id, created_at) VALUES ($1, $2)`, [
      identityId,
      input.now.toISOString(),
    ]);

    const inserted = await tx.query<{ identity_id: string }>(
      `INSERT INTO identity_emails (normalized_email, email, identity_id, verified_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (normalized_email) DO NOTHING
       RETURNING identity_id`,
      [
        normalizedEmail,
        input.email,
        identityId,
        (input.verified ?? true) ? input.now.toISOString() : null,
      ],
    );

    if (inserted.rows[0] !== undefined) {
      return { identityId, created: true };
    }

    // The claim conflicted, so this call did not create the Identity after all.
    // Nothing references the row yet — the address that would have is the one
    // that just failed — so it goes, in the same transaction that made it.
    await tx.query(`DELETE FROM identities WHERE identity_id = $1`, [identityId]);

    // The insert conflicted, so someone else owns this address — either an
    // earlier sign-in or a concurrent one that committed first.
    const existing = await tx.query<{ identity_id: string }>(
      `SELECT identity_id FROM identity_emails WHERE normalized_email = $1`,
      [normalizedEmail],
    );

    const row = existing.rows[0];

    if (row === undefined) {
      throw new Error("Identity claim disappeared during resolution");
    }

    return { identityId: row.identity_id, created: false };
  }

  /**
   * Look up an Identity by address without claiming it.
   *
   * @param email - The address, in any casing.
   * @returns The owning Identity, or undefined if the address is unclaimed.
   */
  async findByEmail(email: string): Promise<string | undefined> {
    const { rows } = await this.pool.query<{ identity_id: string }>(
      `SELECT identity_id FROM identity_emails WHERE normalized_email = $1`,
      [normalizeEmail(email)],
    );

    return rows[0]?.identity_id;
  }

  /**
   * Record that an address has been proven.
   *
   * @param tx - The caller's transaction.
   * @param normalizedEmail - The address in its normalised form.
   * @param at - When control was proven.
   * @returns The owning Identity, or undefined if no such address is claimed.
   *   Idempotent, and it keeps the original timestamp: verifying twice does not
   *   move the moment control was first demonstrated.
   */
  async markEmailVerified(
    tx: Transaction,
    normalizedEmail: string,
    at: Date,
  ): Promise<string | undefined> {
    const { rows } = await tx.query<{ identity_id: string }>(
      `UPDATE identity_emails
          SET verified_at = COALESCE(verified_at, $2)
        WHERE normalized_email = $1
        RETURNING identity_id`,
      [normalizedEmail, at.toISOString()],
    );

    return rows[0]?.identity_id;
  }

  /**
   * Whether an address has been proven.
   *
   * Password sign-in requires it; magic-link sign-in proves it by definition.
   *
   * @param normalizedEmail - The address in its normalised form.
   * @returns Whether it is claimed and verified.
   */
  async isEmailVerified(normalizedEmail: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ verified_at: Date | null }>(
      `SELECT verified_at FROM identity_emails WHERE normalized_email = $1`,
      [normalizedEmail],
    );

    return rows[0]?.verified_at != null;
  }

  /**
   * Read the stored password hash for an Identity, if it has one.
   *
   * @param identityId - Whose password.
   * @returns The stored hash, or undefined if the Identity has none. Absence is
   *   a valid state: magic link remains a way to sign in.
   */
  async findPasswordHash(identityId: string): Promise<string | undefined> {
    const { rows } = await this.pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM identity_passwords WHERE identity_id = $1`,
      [identityId],
    );

    return rows[0]?.password_hash;
  }

  /**
   * Write or replace an Identity's password.
   *
   * @param tx - The caller's transaction.
   * @param identityId - Whose password.
   * @param passwordHash - The PHC-format hash to store.
   * @returns Nothing. Upsert rather than insert: setting a password is the same
   *   operation whether it is the first, a reset, or a change.
   */
  async writePasswordHash(
    tx: Transaction,
    identityId: string,
    passwordHash: string,
  ): Promise<void> {
    await tx.query(
      `INSERT INTO identity_passwords (identity_id, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (identity_id)
       DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
      [identityId, passwordHash],
    );
  }
}
