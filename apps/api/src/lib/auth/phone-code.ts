import { randomInt } from "node:crypto";
import { LessThan } from "typeorm";
import { PhoneSignInCode } from "../../features/authentication/phone.model.js";
import type { Transaction } from "../database/transaction.js";
import { hashToken } from "./tokens.js";

/**
 * Single-use, time-limited codes sent by text.
 *
 * Deliberately not a magic link. A link carries 32 random bytes and cannot be
 * guessed, so its only defences need to be single use and expiry. A code is six
 * digits somebody reads off a screen and types, which is one in a million — low
 * enough that an attacker can simply try, and low enough that the code alone
 * must never be the whole credential.
 *
 * Three things follow, and none of them are optional:
 *
 * - it lives minutes rather than the quarter-hour a link gets;
 * - wrong guesses are counted, and enough of them spend the code even if the
 *   right one arrives afterwards;
 * - consumption requires the number as well as the code, so a code guessed or
 *   intercepted opens only the one telephone it was sent to.
 *
 * Only the hash is stored, so a database leak hands over nothing usable.
 */

/**
 * What a code is allowed to do.
 *
 * Bound into the record and checked on redemption, so a code sent to confirm a
 * number cannot be redeemed to sign in. Without it, claiming a number somebody
 * else holds would hand over a working sign-in code.
 */
export type PhoneCodePurpose = "claim" | "login";

export interface IssuedPhoneCode {
  /** Sent by text. Never stored, never logged. */
  readonly code: string;
  readonly expiresAt: Date;
}

/** How many digits a code has. Six is what people expect to be asked for. */
const CODE_DIGITS = 6;

/**
 * How many wrong guesses spend a code.
 *
 * Low, because the space is small. Five tries against a six-digit code is one
 * chance in two hundred thousand, and the rate limit on requesting a new one is
 * what stops an attacker simply asking for more.
 */
export const MAXIMUM_ATTEMPTS = 5;

/**
 * Issue a code for a number.
 *
 * Any unconsumed code for the same number and purpose is spent first. Unlike a
 * magic link — where leaving old tokens alone stops anybody cancelling
 * somebody else's pending link — a short code left live alongside a new one
 * doubles the number of values an attacker may guess, and every extra live code
 * multiplies that again.
 *
 * @param tx - The caller's transaction, so the code commits with whatever else
 *   the request records.
 * @param input - The number in E.164, what the code is allowed to do, how long
 *   it lives, and the issuing instant.
 * @returns The code to send, and when it expires. Only its hash is stored.
 */
export async function issuePhoneCode(
  tx: Transaction,
  input: {
    normalizedPhone: string;
    purpose: PhoneCodePurpose;
    ttlSeconds: number;
    now: Date;
  },
): Promise<IssuedPhoneCode> {
  await tx
    .createQueryBuilder()
    .update(PhoneSignInCode)
    .set({ consumedAt: input.now })
    .where("normalized_phone = :normalizedPhone", { normalizedPhone: input.normalizedPhone })
    .andWhere("purpose = :purpose", { purpose: input.purpose })
    .andWhere("consumed_at IS NULL")
    .execute();

  // `randomInt` rather than `Math.random`: this is a credential, and a
  // predictable one is no credential at all. Padded so every code is the same
  // length, since a shorter one would be easier to guess and would look wrong.
  const code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0");
  const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000);

  await tx.insert(PhoneSignInCode, {
    codeHash: hashToken(code),
    normalizedPhone: input.normalizedPhone,
    purpose: input.purpose,
    expiresAt,
    consumedAt: null,
    attempts: 0,
    createdAt: input.now,
  });

  return { code, expiresAt };
}

/**
 * Redeem a code, or refuse.
 *
 * The update is the check. Marking the row consumed and requiring it to have
 * been unconsumed, unexpired, under the attempt limit, and issued for this very
 * number happen in one statement, so two simultaneous redemptions of one code
 * cannot both succeed — a read-then-write would let them.
 *
 * @param tx - The caller's transaction; the row is locked only for its
 *   duration.
 * @param input - The number the caller claims, the code they typed, the purpose
 *   it must have been issued for, and the current instant.
 * @returns Whether the code was accepted. A wrong code, an expired one, one
 *   already used, one issued for another number, one of another purpose, and
 *   one whose guesses have run out are all a plain `false`: the differences are
 *   exactly what an attacker is probing for.
 */
export async function consumePhoneCode(
  tx: Transaction,
  input: {
    normalizedPhone: string;
    code: string;
    purpose: PhoneCodePurpose;
    now: Date;
  },
): Promise<boolean> {
  const consumed = await tx
    .createQueryBuilder()
    .update(PhoneSignInCode)
    .set({ consumedAt: input.now })
    .where("code_hash = :codeHash", { codeHash: hashToken(input.code) })
    .andWhere("normalized_phone = :normalizedPhone", { normalizedPhone: input.normalizedPhone })
    .andWhere("purpose = :purpose", { purpose: input.purpose })
    .andWhere("consumed_at IS NULL")
    .andWhere("expires_at > :now", { now: input.now })
    .andWhere("attempts < :maximumAttempts", { maximumAttempts: MAXIMUM_ATTEMPTS })
    .returning(["codeHash"])
    .execute();

  if ((consumed.raw as unknown[]).length > 0) {
    return true;
  }

  await countWrongGuess(tx, input.normalizedPhone, input.purpose);

  return false;
}

/**
 * Count a wrong guess against whatever code is outstanding for a number.
 *
 * Counted against the live code rather than against the one guessed, because
 * the value guessed usually matches no row at all — which is exactly the case
 * that has to be limited. Without this, wrong guesses would cost an attacker
 * nothing.
 *
 * @param tx - The caller's transaction.
 * @param normalizedPhone - Whose code is being guessed at.
 * @param purpose - Which code, since a number may have one of each.
 * @returns Nothing.
 */
async function countWrongGuess(
  tx: Transaction,
  normalizedPhone: string,
  purpose: PhoneCodePurpose,
): Promise<void> {
  await tx
    .createQueryBuilder()
    .update(PhoneSignInCode)
    .set({ attempts: () => "attempts + 1" })
    .where("normalized_phone = :normalizedPhone", { normalizedPhone })
    .andWhere("purpose = :purpose", { purpose })
    .andWhere("consumed_at IS NULL")
    .execute();
}

/**
 * Remove expired codes.
 *
 * Operational hygiene rather than correctness: an expired code is already
 * refused by {@link consumePhoneCode}.
 *
 * @param tx - The caller's transaction.
 * @param now - Anything expiring before this is deleted.
 * @returns How many rows were removed.
 */
export async function purgeExpiredPhoneCodes(tx: Transaction, now: Date): Promise<number> {
  const { affected } = await tx.delete(PhoneSignInCode, { expiresAt: LessThan(now) });

  return affected ?? 0;
}
