import type { SessionCredentials } from "@chronologity/contracts";
import { recallSession } from "../storage/secure-storage";

/**
 * What a cold start knows before it has spoken to anybody.
 *
 * **A stored credential is a claim, not a Session.** `authentication.md:1271`
 * is unambiguous: a client "must not assume that a locally stored credential
 * proves the Session is still valid server-side." It may have been revoked from
 * another device, expired while the app was closed, or — on iOS, where the
 * Keychain outlives the app — belong to an installation that was deleted.
 *
 * So restoration deliberately does not decide that anybody is signed in. It
 * produces credentials whose access token is **already expired**, which makes
 * the first request refresh before it sends anything. The server then answers
 * the only question that matters. A 401 clears the Session (ADR-153) and the
 * person signs in again; anything else leaves it intact, because a backend
 * briefly unreachable has not ended anybody's Session.
 *
 * That is why the restored access token is the empty string rather than
 * something plausible. There is nothing useful to put there — the real one
 * expired minutes after it was issued and was never written down — and a value
 * that looked usable would be one somebody might use.
 */

/** What was found on disk, turned into something the Session can hold. */
export interface Restored {
  /** Credentials to adopt, or undefined when this is a fresh start. */
  readonly credentials: SessionCredentials | undefined;
}

/**
 * Recover the previous Session, if there was one.
 *
 * @param now - The clock, injectable so a test need not wait for a month to
 *   pass.
 * @returns The credentials to start from. Undefined when nothing was stored,
 *   when the store could not be read, or when the refresh credential has
 *   already lapsed — in which case the round trip that would have discovered
 *   that is skipped.
 */
export async function restoreSession(now: () => number = Date.now): Promise<Restored> {
  const stored = await recallSession();

  if (stored === undefined) {
    return { credentials: undefined };
  }

  // Known to be spent. Sending it would be one request to learn something the
  // expiry already said.
  if (Date.parse(stored.refreshTokenExpiresAt) <= now()) {
    return { credentials: undefined };
  }

  return {
    credentials: {
      sessionId: stored.sessionId,
      // Expired on purpose, so the first request refreshes rather than trying a
      // token this device does not have.
      accessToken: "",
      accessTokenExpiresAt: new Date(0).toISOString(),
      refreshToken: stored.refreshToken,
      refreshTokenExpiresAt: stored.refreshTokenExpiresAt,
    },
  };
}
