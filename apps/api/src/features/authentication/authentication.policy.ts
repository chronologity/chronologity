import type { MagicLinkPurpose } from "../../lib/auth/magic-link.js";
import type { RefreshRejection, SessionRecord } from "./authentication.types.js";

/**
 * The rules authentication decides by.
 *
 * Pure and exhaustively unit tested, because these are the decisions that
 * matter and none of them needs a database to make. The services read rows and
 * write them; what a row means is here.
 */

/**
 * Normalise an email for identity resolution.
 *
 * Deliberately conservative: lowercase and trim, nothing more. Aggressive
 * normalisation — stripping dots, cutting everything after a plus sign — is
 * provider-specific, and applying it universally silently merges addresses
 * that belong to different people.
 *
 * @param email - The address as given.
 * @returns The form used to decide whether two addresses are the same one.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Whether a Session may authenticate a request right now.
 *
 * @param session - The Session as stored.
 * @param now - The instant to judge against.
 * @returns Whether it has not been revoked and has not expired. Expiry is
 *   evaluated against the clock rather than against a stored status, because
 *   expiry is the passage of time and not an action anyone takes.
 */
export function isUsable(session: SessionRecord, now: Date): boolean {
  if (session.revokedAt !== null) {
    return false;
  }

  return session.expiresAt.getTime() > now.getTime();
}

/**
 * Why a refresh could not proceed.
 *
 * Called only after the conditional update matched nothing, to say which of
 * the four reasons it was. The caller is told none of them — all four are one
 * 401 — but the audit trail records which, and one of them means the Session
 * must be ended rather than merely refused.
 *
 * @param session - The Session as stored, or undefined if there is no such row.
 * @param presentedTokenHash - Hash of the credential the caller presented.
 * @param now - The instant to judge against.
 * @returns The reason, or undefined when the Session is in fact refreshable
 *   with that credential — which can only mean it changed between the update
 *   and this read, and is therefore not something to act on.
 */
export function classifyRefreshFailure(
  session: SessionRecord | undefined,
  presentedTokenHash: string,
  now: Date,
): RefreshRejection | undefined {
  if (session === undefined) {
    return "session_not_found";
  }

  if (session.revokedAt !== null) {
    return "session_revoked";
  }

  if (session.expiresAt.getTime() <= now.getTime()) {
    return "session_expired";
  }

  if (session.refreshTokenHash !== presentedTokenHash) {
    // An already-rotated credential is in circulation: either it leaked or a
    // client is replaying an old one, and the two are indistinguishable from
    // here. Refusing a stolen credential while leaving the Session alive lets
    // whoever holds it keep trying, so the Session ends. This is the response
    // `authentication.md:490` leaves to be defined.
    return "refresh_token_mismatch";
  }

  return undefined;
}

/**
 * Whether a refusal should end the Session as well as refuse the request.
 *
 * @param rejection - Why the refresh was refused.
 * @returns Whether the Session must be revoked. Only credential reuse
 *   qualifies: an expired or already-revoked Session needs nothing further
 *   done to it.
 */
export function endsSession(rejection: RefreshRejection): boolean {
  return rejection === "refresh_token_mismatch";
}

const SIGN_IN_PATH = "/sessions";

const LINK_PATHS: Record<MagicLinkPurpose, string> = {
  login: SIGN_IN_PATH,
  verify_email: "/email-verifications",
  reset_password: "/password-resets/complete",
  confirm_deletion: "/account-deletions/confirm",
  confirm_export: "/data-exports/confirm",
};

/**
 * Where a link of a given purpose sends someone.
 *
 * One configured base URL covers them all, because they are the same client
 * application reached at different paths, and asking an operator to configure
 * several URLs that must agree invites them to disagree.
 *
 * The sign-in path is taken off the end and the purpose's path put in its
 * place. Only off the end: a host that happens to contain the sign-in path
 * would otherwise be rewritten instead of the path, and the link would go
 * somewhere that does not exist.
 *
 * @param baseUrl - The configured sign-in URL. A trailing sign-in path is
 *   replaced; a base without one is treated as the root the paths hang off.
 * @param purpose - What the link is for.
 * @param token - The raw token to carry.
 * @returns The URL to put in the email.
 */
export function linkUrlFor(baseUrl: string, purpose: MagicLinkPurpose, token: string): string {
  const root = baseUrl.endsWith(SIGN_IN_PATH)
    ? baseUrl.slice(0, -SIGN_IN_PATH.length)
    : baseUrl;

  return `${root}${LINK_PATHS[purpose]}?token=${token}`;
}

/**
 * How long a link lasts, in whole minutes, for saying so in an email.
 *
 * @param ttlSeconds - The configured lifetime.
 * @returns The lifetime in minutes, rounded, and never below one: a link that
 *   announces it expires in zero minutes reads as already dead.
 */
export function linkLifetimeMinutes(ttlSeconds: number): number {
  return Math.max(1, Math.round(ttlSeconds / 60));
}
