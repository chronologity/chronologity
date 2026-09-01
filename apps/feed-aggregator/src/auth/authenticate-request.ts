import { identifierSchema } from "@chronologity/contracts";
import { jwtVerify } from "jose";
import type { AuthConfig } from "../config/auth-config.js";
import { UnauthenticatedError } from "../errors/aggregator-error.js";
import { ANONYMOUS, type Viewer } from "./auth-context.js";
import type { SessionLookup } from "./session.repository.js";

/**
 * Establishing who is asking, once per request.
 *
 * Two checks, both required, and both the same ones `apps/api` makes. The token
 * must verify — signature, issuer, audience, expiry — and the Session it names
 * must still be open. The second is what makes revocation immediate: a signed,
 * unexpired token whose Session was revoked a moment ago authenticates nothing.
 *
 * Verifying the signature alone would have been cheaper and would have kept
 * PostgreSQL out of this application entirely. It would also have meant that
 * signing out stopped writes at once and stopped reads up to ten minutes later
 * — and reads are the whole of what somebody signs out to stop somebody else
 * seeing.
 *
 * This is Pattern A of the two `authentication.md:600` leaves open: the
 * aggregator verifies the same credential itself, rather than trusting identity
 * forwarded by a gateway. There is no gateway to trust yet, and a service that
 * believed a header would believe anybody who could set one.
 */

/** How a bearer credential is presented. */
const BEARER = "Bearer ";

/**
 * Resolve the Viewer for a request.
 *
 * @param header - The `authorization` header exactly as received, or undefined.
 * @param config - The secret, issuer and audience a token must satisfy.
 * @param sessions - Where to ask whether the Session is still open.
 * @param now - The instant to judge the Session's expiry against. The token's
 *   own expiry is checked by `jwtVerify` against the real clock.
 * @returns An anonymous Viewer when no credential was offered, or an
 *   authenticated one when a credential was offered and holds up.
 * @throws {UnauthenticatedError} If a credential was offered and did not hold
 *   up, for any reason: a scheme other than Bearer, a failed signature, the
 *   wrong issuer or audience, an expired token, missing or malformed claims, a
 *   Session that is revoked, expired or absent, or a Session belonging to a
 *   different Identity than the token claims. Every one of these is the same
 *   error — which of the checks refused is not the caller's business, and
 *   saying would tell somebody probing which one to work on next.
 */
export async function authenticateRequest(
  header: string | undefined,
  config: AuthConfig,
  sessions: SessionLookup,
  now: Date,
): Promise<Viewer> {
  // No credential at all is not a failure. Public history is readable without
  // an account, and this is how somebody reading it arrives.
  if (header === undefined || header.length === 0) {
    return ANONYMOUS;
  }

  // A credential that was offered, though. From here every path either
  // authenticates or refuses — never quietly falls back to anonymous, which
  // would show a client with an expired token less history than it asked for
  // and no reason why.
  if (!header.startsWith(BEARER)) {
    throw new UnauthenticatedError("Authentication required");
  }

  const token = header.slice(BEARER.length).trim();

  let payload;
  try {
    ({ payload } = await jwtVerify(token, config.jwtSecret, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ["HS256"],
    }));
  } catch {
    // Deliberately swallowed: the reason a token failed is not the caller's
    // business, and logging it here would log the token.
    throw new UnauthenticatedError("Authentication required");
  }

  const identityId = payload.sub;
  const sessionId = payload.sid;
  const userId = payload.uid;

  // Shape-checked before the query, not only for type narrowing: `session_id`
  // is a `uuid` column, and PostgreSQL raises on a comparison against something
  // that is not one. Checking here turns that into the refusal it should be
  // rather than an internal error.
  if (!isIdentifier(identityId) || !isIdentifier(sessionId)) {
    throw new UnauthenticatedError("Authentication required");
  }

  const session = await sessions.findOpen(sessionId, now);

  if (session === undefined || session.identityId !== identityId) {
    throw new UnauthenticatedError("Authentication required");
  }

  return {
    kind: "authenticated",
    identityId,
    sessionId,
    // From the claim alone. A token issued before onboarding carries none, and
    // resolving it would be deciding what an unonboarded Viewer may read, which
    // is a question for the eligibility rules rather than for token parsing.
    userId: isIdentifier(userId) ? userId : undefined,
  };
}

/**
 * Whether a claim is a Chronologity identifier.
 *
 * @param claim - The claim as it came out of the token, which is `unknown`
 *   because a JWT payload is whatever was signed.
 * @returns Whether it is a string in the form every Chronologity identifier
 *   takes.
 */
function isIdentifier(claim: unknown): claim is string {
  return typeof claim === "string" && identifierSchema.safeParse(claim).success;
}
