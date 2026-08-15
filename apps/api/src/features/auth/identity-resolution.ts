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
 * Find the Identity for a verified address, claiming it if unclaimed.
 *
 * Called only after a magic link has been redeemed, so the address is proven
 * rather than asserted; the row is written already verified.
 */
export async function resolveIdentityForEmail(
  tx: Transaction,
  input: { email: string; now: Date },
): Promise<ResolvedIdentity> {
  const normalizedEmail = normalizeEmail(input.email);

  const inserted = await tx.query<{ identity_id: string }>(
    `INSERT INTO identity_emails (normalized_email, email, identity_id, verified_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (normalized_email) DO NOTHING
     RETURNING identity_id`,
    [normalizedEmail, input.email, generateId(), input.now.toISOString()],
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

/** Look up an Identity by address without claiming it. */
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
