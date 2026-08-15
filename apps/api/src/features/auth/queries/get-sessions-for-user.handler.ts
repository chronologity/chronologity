import type { SessionSummary } from "@chronologity/contracts";
import type { AuthDependencies } from "../dependencies.js";
import type { GetSessionsForUserQuery } from "./get-sessions-for-user.query.js";

/**
 * The active Sessions for an Identity.
 *
 * Served from the `sessions` read model, which is appropriate here: this is a
 * listing, not an access decision, and being a moment stale costs nothing.
 * Revoked sessions are omitted rather than shown as ended — someone reviewing
 * their devices wants to know what is open now.
 */
export async function handleGetSessionsForUser(
  deps: AuthDependencies,
  query: GetSessionsForUserQuery,
): Promise<SessionSummary[]> {
  const { rows } = await deps.pool.query<{
    session_id: string;
    created_at: Date;
    expires_at: Date;
    last_refreshed_at: Date | null;
  }>(
    `SELECT session_id, created_at, expires_at, last_refreshed_at
       FROM sessions
      WHERE identity_id = $1 AND revoked_at IS NULL
      ORDER BY created_at DESC`,
    [query.identityId],
  );

  return rows.map((row) => ({
    sessionId: row.session_id,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    lastRefreshedAt: row.last_refreshed_at?.toISOString() ?? null,
    current: row.session_id === query.currentSessionId,
  }));
}
