import { recordAuthAudit } from "../../../lib/auth/audit.js";
import { withTransaction } from "../../../lib/database/transaction.js";
import type { RequestContext } from "../../../types/request-context.js";
import type { AuthDependencies } from "../dependencies.js";
import { revokeSession } from "./revoke-session.command.js";
import { handleRevokeSession } from "./revoke-session.handler.js";
import type { RevokeAllUserSessionsCommand } from "./revoke-all-user-sessions.command.js";

/**
 * Log out everywhere.
 *
 * Sessions are enumerated from the read model, which is the only place that
 * knows what an Identity has open, and each one is then ended through its own
 * aggregate, which remains the authority. Reading a list from derived state is
 * safe; deciding validity from it would not be.
 */
export async function handleRevokeAllUserSessions(
  deps: AuthDependencies,
  command: RevokeAllUserSessionsCommand,
  context: RequestContext,
): Promise<number> {
  const { identityId, reason } = command.payload;

  const { rows } = await deps.pool.query<{ session_id: string }>(
    `SELECT session_id FROM sessions WHERE identity_id = $1 AND revoked_at IS NULL`,
    [identityId],
  );

  let revoked = 0;

  for (const row of rows) {
    await handleRevokeSession(deps, revokeSession(row.session_id, identityId, reason), context);
    revoked += 1;
  }

  await withTransaction(deps.pool, (tx) =>
    recordAuthAudit(tx, {
      eventType: "all_sessions_revoked",
      outcome: "success",
      identityId,
      reason,
      traceId: context.traceId,
      context: { revoked },
    }),
  );

  return revoked;
}
