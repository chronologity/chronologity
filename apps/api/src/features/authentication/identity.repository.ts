import type { DataSource } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import { Identity, IdentityEmail, IdentityPassword } from "./identity.model.js";
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
 * Reads take the DataSource and writes take a transaction, except where a read is
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
   * @param dataSource - Used for reads that stand alone.
   */
  constructor(private readonly dataSource: DataSource) {}

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
    await tx.insert(Identity, { identityId, createdAt: input.now });

    // `orIgnore` is ON CONFLICT DO NOTHING. What comes back from RETURNING is
    // what says this call claimed the address: the identifiers a conflicting
    // insert reports are the ones handed to it, not the ones written.
    const claimed = await tx
      .createQueryBuilder()
      .insert()
      .into(IdentityEmail)
      .values({
        normalizedEmail,
        email: input.email,
        identityId,
        verifiedAt: (input.verified ?? true) ? input.now : null,
        createdAt: input.now,
      })
      .orIgnore()
      .returning(["normalizedEmail"])
      .execute();

    if ((claimed.raw as unknown[]).length === 1) {
      return { identityId, created: true };
    }

    // The claim conflicted, so this call did not create the Identity after all.
    // Nothing references the row yet — the address that would have is the one
    // that just failed — so it goes, in the same transaction that made it.
    await tx.delete(Identity, { identityId });

    // The insert conflicted, so someone else owns this address — either an
    // earlier sign-in or a concurrent one that committed first.
    const row = await tx.findOne(IdentityEmail, {
      where: { normalizedEmail },
      select: { identityId: true },
    });

    if (row === null) {
      throw new Error("Identity claim disappeared during resolution");
    }

    return { identityId: row.identityId, created: false };
  }

  /**
   * Look up an Identity by address without claiming it.
   *
   * @param email - The address, in any casing.
   * @returns The owning Identity, or undefined if the address is unclaimed.
   */
  async findByEmail(email: string): Promise<string | undefined> {
    const row = await this.dataSource.getRepository(IdentityEmail).findOne({
      where: { normalizedEmail: normalizeEmail(email) },
      select: { identityId: true },
    });

    return row?.identityId;
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
    // Only an unverified address is written, which is what keeps the original
    // moment when this runs twice.
    const verified = await tx
      .createQueryBuilder()
      .update(IdentityEmail)
      .set({ verifiedAt: at })
      .where("normalized_email = :normalizedEmail", { normalizedEmail })
      .andWhere("verified_at IS NULL")
      .returning(["identityId"])
      .execute();

    const written = (verified.raw as { identity_id: string }[])[0];

    if (written !== undefined) {
      return written.identity_id;
    }

    // Nothing was written, which means the address is already verified or is
    // not claimed at all. Those are different answers, so they are read apart
    // rather than both reported as failure.
    const existing = await tx.findOne(IdentityEmail, {
      where: { normalizedEmail },
      select: { identityId: true },
    });

    return existing?.identityId;
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
    const row = await this.dataSource
      .getRepository(IdentityEmail)
      .findOne({ where: { normalizedEmail }, select: { verifiedAt: true } });

    return row?.verifiedAt != null;
  }

  /**
   * Read the stored password hash for an Identity, if it has one.
   *
   * @param identityId - Whose password.
   * @returns The stored hash, or undefined if the Identity has none. Absence is
   *   a valid state: magic link remains a way to sign in.
   */
  async findPasswordHash(identityId: string): Promise<string | undefined> {
    const row = await this.dataSource
      .getRepository(IdentityPassword)
      .findOne({ where: { identityId }, select: { passwordHash: true } });

    return row?.passwordHash;
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
    const now = new Date();

    await tx
      .createQueryBuilder()
      .insert()
      .into(IdentityPassword)
      .values({ identityId, passwordHash, createdAt: now, updatedAt: now })
      .orUpdate(["password_hash", "updated_at"], ["identity_id"])
      .execute();
  }
}
