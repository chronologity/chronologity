import { randomBytes } from "node:crypto";
import { LessThan } from "typeorm";
import { MagicLinkToken } from "../../features/authentication/session.model.js";
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
/**
 * What a link is for.
 *
 * A link is only ever accepted for the purpose it was issued with, so these are
 * not interchangeable: a verification link cannot delete an account and a
 * deletion link cannot sign anybody in. The column carries no check constraint,
 * because this type is the vocabulary and the database has no opinion about it.
 */
export type MagicLinkPurpose =
  | "login"
  | "verify_email"
  | "reset_password"
  /**
   * Proving current control of the address before an account is deleted.
   *
   * A live session proves somebody signed in once, which an unattended laptop
   * also proves. Consuming one of these proves they can read the mailbox now —
   * and the mail arriving is itself the control, because somebody who has taken
   * an account over cannot quietly delete it without the owner seeing this.
   */
  | "confirm_deletion"
  /**
   * Proving current control of the address before a copy of everything is made.
   *
   * The same reasoning as deletion: an export is the whole of somebody's
   * history, and a session shows only that somebody signed in once.
   */
  | "confirm_export";

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

  await tx.insert(MagicLinkToken, {
    tokenHash: hashToken(token),
    email: input.email,
    purpose: input.purpose,
    expiresAt,
    consumedAt: null,
    createdAt: input.now,
  });

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
  const consumed = await tx
    .createQueryBuilder()
    .update(MagicLinkToken)
    .set({ consumedAt: input.now })
    .where("token_hash = :tokenHash", { tokenHash: hashToken(input.token) })
    .andWhere("purpose = :purpose", { purpose: input.purpose })
    .andWhere("consumed_at IS NULL")
    .andWhere("expires_at > :now", { now: input.now })
    .returning(["email", "purpose"])
    .execute();

  const row = (consumed.raw as { email: string; purpose: string }[])[0];

  return row === undefined
    ? undefined
    : { email: row.email, purpose: row.purpose as MagicLinkPurpose };
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
  const { affected } = await tx.delete(MagicLinkToken, { expiresAt: LessThan(now) });

  return affected ?? 0;
}
