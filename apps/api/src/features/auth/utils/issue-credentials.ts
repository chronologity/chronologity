import type { SessionCredentials } from "@chronologity/contracts";
import type { IssuedAccessToken } from "../../../lib/auth/tokens.js";

/**
 * Assemble the credential pair returned to a client.
 *
 * @param input - The Session, the issued access token, and the refresh
 *   credential with its expiry.
 * @returns The pair to return to the client. The refresh credential appears here
 *   once and is never retrievable again; only its hash is kept.
 */
export function toSessionCredentials(input: {
  sessionId: string;
  access: IssuedAccessToken;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}): SessionCredentials {
  return {
    sessionId: input.sessionId,
    accessToken: input.access.token,
    accessTokenExpiresAt: input.access.expiresAt.toISOString(),
    refreshToken: input.refreshToken,
    refreshTokenExpiresAt: input.refreshTokenExpiresAt.toISOString(),
  };
}
