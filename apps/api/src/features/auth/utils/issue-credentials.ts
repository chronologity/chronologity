import type { SessionCredentials } from "@chronologity/contracts";
import type { IssuedAccessToken } from "../../../lib/auth/tokens.js";

/** Assemble the credential pair returned to a client. */
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
