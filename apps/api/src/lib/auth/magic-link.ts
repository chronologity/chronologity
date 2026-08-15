import { randomBytes } from "node:crypto";
import type { Transaction } from "../database/transaction.js";
import { hashToken } from "./tokens.js";

/**
 * Single-use, time-limited login links.
 *
 * The link is the only thing a person needs to authenticate, so it is treated
 * as a bearer secret: unguessable, short-lived, stored only as a hash, and
 * usable exactly once. `authentication.md:262-286` requires all four.
 */

/**
 * What a link is allowed to do.
 *
 * Purpose is bound into the token record and checked on redemption, so a link
 * sent to verify an address cannot be redeemed to set a new password. Without
 * it, one link type would be a skeleton key for the others.
 */
export type MagicLinkPurpose = "login" | "verify_email" | "reset_password";

export interface IssuedMagicLink {
  /** Sent to the address. Never stored, never logged. */
  readonly token: string;
  readonly expiresAt: Date;
}

export interface ConsumedMagicLink {
  readonly email: string;
  readonly purpose: MagicLinkPurpose;
}

/**
 * Issue a link token for an address.
 *
 * Existing unconsumed tokens for the address are left alone: invalidating them
 * would let anyone cancel someone else's pending link by requesting a new one.
 *
 * @param tx - The caller's transaction, so the token commits with whatever
 *   else the request records.
 * @param input - The address, what the link is allowed to do, how long it
 *   lives, and the issuing instant.
 * @returns The token to email, and when it expires. Only its hash is stored.
 */
export async function issueMagicLink(
  tx: Transaction,
  input: { email: string; purpose: MagicLinkPurpose; ttlSeconds: number; now: Date },
): Promise<IssuedMagicLink> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000);

  await tx.query(
    `INSERT INTO magic_link_tokens (token_hash, email, purpose, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [hashToken(token), input.email, input.purpose, expiresAt.toISOString()],
  );

  return { token, expiresAt };
}

/**
 * Consume a link token, or return undefined if it cannot be used.
 *
 * The update is the check. Marking the row consumed and requiring it to have
 * been unconsumed happen in one statement, so two simultaneous redemptions of
 * the same link cannot both succeed — a read-then-write would let them.
 *
 * @param tx - The caller's transaction; the row is locked only for its
 *   duration.
 * @param input - The raw token from the link, the purpose it must have been
 *   issued for, and the current instant.
 * @returns The address the link was issued for, or undefined when the token is
 *   expired, already consumed, of the wrong purpose, or was never issued. All
 *   four are deliberately indistinguishable to the caller.
 */
export async function consumeMagicLink(
  tx: Transaction,
  input: { token: string; purpose: MagicLinkPurpose; now: Date },
): Promise<ConsumedMagicLink | undefined> {
  const { rows } = await tx.query<{ email: string; purpose: MagicLinkPurpose }>(
    `UPDATE magic_link_tokens
        SET consumed_at = $4
      WHERE token_hash = $1
        AND purpose = $2
        AND consumed_at IS NULL
        AND expires_at > $3
      RETURNING email, purpose`,
    [hashToken(input.token), input.purpose, input.now.toISOString(), input.now.toISOString()],
  );

  return rows[0];
}

/**
 * Remove expired tokens.
 *
 * Operational hygiene rather than correctness: an expired token is already
 * refused by {@link consumeMagicLink}.
 *
 * @param tx - The caller's transaction.
 * @param now - Anything expiring before this is deleted.
 * @returns How many rows were removed.
 */
export async function purgeExpiredMagicLinks(tx: Transaction, now: Date): Promise<number> {
  const result = await tx.query(`DELETE FROM magic_link_tokens WHERE expires_at < $1`, [
    now.toISOString(),
  ]);

  return result.rowCount ?? 0;
}
