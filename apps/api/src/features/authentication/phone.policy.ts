/**
 * When a phone number may still be used to sign in.
 *
 * Pure, and the whole defence against recycled numbers.
 *
 * Phone numbers are leased rather than owned. A carrier disconnects a number
 * when somebody stops paying and, after a holding period, gives it to a
 * different person entirely. That person can then receive a code sent to it,
 * which is the entire attack — no skill, no interception, just answering their
 * own telephone.
 *
 * What makes it tractable is that reassignment has a precondition: a number is
 * only recycled after its holder stops using it. So dormancy, not the code
 * itself, is what is checked. A number that has gone quiet stops working for
 * sign-in until its holder re-confirms it, and re-confirmation runs through the
 * account's email address — which whoever received the recycled number does not
 * have.
 *
 * **This does not stop SIM swap**, where an attacker persuades a carrier to
 * move a live number to their own SIM. Nothing buildable without carrier data
 * does. Detecting that needs a provider that can report a recent swap, and the
 * place for it is where the code is sent.
 */

/** Why a number may not be used to sign in. */
export type PhoneSignInRefusal = "unverified" | "dormant";

/**
 * How long a number may go unused before it must be re-confirmed.
 *
 * Sixty days is comfortably inside the shortest period a carrier holds a
 * disconnected number before reassigning it, so a number that changes hands is
 * locked out before it can reach anybody new. The cost is that somebody who
 * signs in by email for two months re-confirms their number before using it
 * again, which is a small price for the failure it prevents.
 */
export const DORMANT_AFTER_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Decide whether a number may sign somebody in.
 *
 * @param phone - When the number was proven, and when it was last used. A
 *   number never used is measured from when it was proven, because that is the
 *   last moment anybody demonstrated they held it.
 * @param now - The current instant.
 * @returns Why to refuse, or undefined when the number may be used.
 */
export function checkPhoneSignIn(
  phone: { readonly verifiedAt: Date | null; readonly lastSignedInAt: Date | null },
  now: Date,
): PhoneSignInRefusal | undefined {
  if (phone.verifiedAt === null) {
    return "unverified";
  }

  const lastProof = phone.lastSignedInAt ?? phone.verifiedAt;

  if (now.getTime() - lastProof.getTime() > DORMANT_AFTER_DAYS * DAY_MS) {
    return "dormant";
  }

  return undefined;
}
