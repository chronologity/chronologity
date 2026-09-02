import type { DataSource } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import { IdentityPhone } from "./phone.model.js";

/** What is known about the one number an Identity holds. */
export interface StoredPhone {
  readonly normalizedPhone: string;
  readonly phone: string;
  readonly identityId: string;
  readonly verifiedAt: Date | null;
  readonly lastSignedInAt: Date | null;
}

/** Reads and writes the phone numbers Identities sign in with. */
export class PhoneRepository {
  /**
   * Build the phone repository.
   *
   * @param dataSource - Used for reads. Writes take a transaction of their own.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Find whoever holds a number.
   *
   * @param normalizedPhone - In E.164.
   * @returns What is known about it, or undefined when nobody holds it.
   */
  async findByPhone(normalizedPhone: string): Promise<StoredPhone | undefined> {
    const row = await this.dataSource
      .getRepository(IdentityPhone)
      .findOneBy({ normalizedPhone });

    return row ?? undefined;
  }

  /**
   * Find the number an Identity holds.
   *
   * @param identityId - Whose number.
   * @returns What is known about it, or undefined when they hold none.
   */
  async findByIdentity(identityId: string): Promise<StoredPhone | undefined> {
    const row = await this.dataSource.getRepository(IdentityPhone).findOneBy({ identityId });

    return row ?? undefined;
  }

  /**
   * Claim a number for an Identity, replacing whatever they held before.
   *
   * Unverified. Claiming does not prove control; a code sent to the number
   * does, exactly as registering an address does not prove it.
   *
   * @param tx - The caller's transaction. Both writes share it, so an Identity
   *   is never briefly holding two numbers or none.
   * @param identityId - Who is claiming.
   * @param normalizedPhone - In E.164.
   * @param phone - As typed.
   * @param at - When.
   * @returns Whether the claim was recorded. False means somebody else already
   *   holds that number — decided by the primary key rather than by a prior
   *   read, so two simultaneous claims cannot both succeed.
   */
  async claim(
    tx: Transaction,
    identityId: string,
    normalizedPhone: string,
    phone: string,
    at: Date,
  ): Promise<boolean> {
    // Whatever they held before goes first, so the unique constraint on
    // `identity_id` cannot refuse a legitimate replacement.
    await tx.delete(IdentityPhone, { identityId });

    const inserted = await tx
      .createQueryBuilder()
      .insert()
      .into(IdentityPhone)
      .values({
        normalizedPhone,
        phone,
        identityId,
        verifiedAt: null,
        lastSignedInAt: null,
        createdAt: at,
      })
      .orIgnore()
      // Explicit, and checked by length. `orIgnore` populates `identifiers`
      // whether or not the row was inserted, so the returned rows are the only
      // honest signal that anything was written (ADR-102).
      .returning(["normalizedPhone"])
      .execute();

    return (inserted.raw as unknown[]).length > 0;
  }

  /**
   * Record that control of a number has been proven.
   *
   * @param tx - The caller's transaction.
   * @param normalizedPhone - Which number.
   * @param at - When it was proven.
   * @returns Whether a number was marked. False means it was not there to mark.
   */
  async markVerified(tx: Transaction, normalizedPhone: string, at: Date): Promise<boolean> {
    const { affected } = await tx.update(
      IdentityPhone,
      { normalizedPhone },
      { verifiedAt: at },
    );

    return (affected ?? 0) > 0;
  }

  /**
   * Record that a number was just used to sign in.
   *
   * This is what keeps a number out of dormancy, so it is written on every
   * successful phone sign-in rather than only the first.
   *
   * @param tx - The caller's transaction.
   * @param normalizedPhone - Which number.
   * @param at - When.
   * @returns Nothing.
   */
  async markSignedIn(tx: Transaction, normalizedPhone: string, at: Date): Promise<void> {
    await tx.update(IdentityPhone, { normalizedPhone }, { lastSignedInAt: at });
  }

  /**
   * Remove the number an Identity holds.
   *
   * @param tx - The caller's transaction.
   * @param identityId - Whose number.
   * @returns Whether one was removed. False means they held none, which is the
   *   state the caller asked for and not an error.
   */
  async remove(tx: Transaction, identityId: string): Promise<boolean> {
    const { affected } = await tx.delete(IdentityPhone, { identityId });

    return (affected ?? 0) > 0;
  }
}
