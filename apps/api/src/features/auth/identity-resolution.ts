import type { Transaction } from "../../lib/database/transaction.js";
import { generateId } from "../../lib/ids/generate-id.js";
import { normalizeEmail } from "./aggregates/identity.aggregate.js";

/**
 * Resolving an email address to an Identity.
 *
 * `identity_emails` is the authority for which Identity owns a login address,
 * and its unique constraint is what makes first login safe under concurrency:
 * two simultaneous first logins for the same address both attempt the insert,
 * the database picks a winner, and the loser reads back the winner's Identity.
 * Deciding this in application code — read, then create if absent — would let
 * both win and split one person across two accounts.
 *
 * The Identity aggregate's history is written after this claim is established.
 * The claim is what must be unique; the history is what must be auditable.
 */

export interface ResolvedIdentity {
  readonly identityId: string;
  /** True when this call created the claim, meaning the aggregate needs writing. */
  readonly created: boolean;
}

/**
 * Find the Identity for an address, claiming it if unclaimed.
 *
 * @param tx - The caller's transaction. The unique constraint decides the
 *   winner when two first sign-ins race, which is why this must not be split
 *   into a read and a later write.
 * @param input - The address, the current instant, and whether control of the
 *   address has actually been proven. Redeeming a magic link proves it;
 *   registering with a password does not, and recording an unproven address as
 *   verified would let anyone claim someone else's by typing it.
 * @returns The owning Identity, and whether this call created the claim.
 * @throws {Error} If the conflicting row disappears between the insert and the
 *   read that follows it. Failing is correct: guessing an Identity here would
 *   attach a Session to the wrong account.
 */
export async function resolveIdentityForEmail(
  tx: Transaction,
  input: { email: string; now: Date; verified?: boolean },
): Promise<ResolvedIdentity> {
  const normalizedEmail = normalizeEmail(input.email);

  const inserted = await tx.query<{ identity_id: string }>(
    `INSERT INTO identity_emails (normalized_email, email, identity_id, verified_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (normalized_email) DO NOTHING
     RETURNING identity_id`,
    [
      normalizedEmail,
      input.email,
      generateId(),
      (input.verified ?? true) ? input.now.toISOString() : null,
    ],
  );

  const claimed = inserted.rows[0];

  if (claimed !== undefined) {
    return { identityId: claimed.identity_id, created: true };
  }

  // The insert conflicted, so someone else owns this address — either an
  // earlier login or a concurrent one that committed first.
  const existing = await tx.query<{ identity_id: string }>(
    `SELECT identity_id FROM identity_emails WHERE normalized_email = $1`,
    [normalizedEmail],
  );

  const row = existing.rows[0];

  if (row === undefined) {
    // The conflicting row vanished between the insert and this read, which
    // means something deleted it mid-flight. Failing is correct: guessing an
    // Identity here would attach a session to the wrong account.
    throw new Error("Identity claim disappeared during resolution");
  }

  return { identityId: row.identity_id, created: false };
}

/**
 * Look up an Identity by address without claiming it.
 *
 * @param tx - The caller's transaction.
 * @param email - The address, in any casing.
 * @returns The owning Identity, or undefined if the address is unclaimed.
 */
export async function findIdentityByEmail(
  tx: Transaction,
  email: string,
): Promise<string | undefined> {
  const { rows } = await tx.query<{ identity_id: string }>(
    `SELECT identity_id FROM identity_emails WHERE normalized_email = $1`,
    [normalizeEmail(email)],
  );

  return rows[0]?.identity_id;
}

/**
 * Record that an address has been proven.
 *
 * Idempotent, and it keeps the original timestamp: verifying twice does not
 * move the moment control was first demonstrated.
 *
 * @param tx - The caller's transaction.
 * @param normalizedEmail - The address in its normalised form.
 * @param at - When control was proven.
 * @returns The owning Identity, or undefined if no such address is claimed.
 */
export async function markEmailVerified(
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
 * @param tx - The caller's transaction.
 * @param normalizedEmail - The address in its normalised form.
 * @returns Whether it is claimed and verified.
 */
export async function isEmailVerified(tx: Transaction, normalizedEmail: string): Promise<boolean> {
  const { rows } = await tx.query<{ verified_at: Date | null }>(
    `SELECT verified_at FROM identity_emails WHERE normalized_email = $1`,
    [normalizedEmail],
  );

  return rows[0]?.verified_at != null;
}
