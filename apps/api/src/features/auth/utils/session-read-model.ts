import type { Transaction } from "../../../lib/database/transaction.js";

/**
 * The `sessions` table: what a person sees on their devices screen.
 *
 * Maintained by the command that caused the change rather than by an
 * asynchronous projection, so a session appears in the list immediately after
 * signing in. Safe to write here precisely because this table decides nothing:
 * a lost write costs a row in a list, never an access decision.
 */
export async function recordSessionCreated(
  tx: Transaction,
  input: {
    sessionId: string;
    identityId: string;
    createdAt: Date;
    expiresAt: Date;
    clientKind: string | undefined;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO sessions (session_id, identity_id, created_at, expires_at, client_kind)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (session_id) DO NOTHING`,
    [
      input.sessionId,
      input.identityId,
      input.createdAt.toISOString(),
      input.expiresAt.toISOString(),
      input.clientKind ?? null,
    ],
  );
}

export async function recordSessionRefreshed(
  tx: Transaction,
  sessionId: string,
  at: Date,
): Promise<void> {
  await tx.query(`UPDATE sessions SET last_refreshed_at = $2 WHERE session_id = $1`, [
    sessionId,
    at.toISOString(),
  ]);
}

/**
 * Mark a session revoked.
 *
 * `COALESCE` keeps the first revocation: the reason a session ended is the one
 * that ended it, and a later logout should not overwrite evidence of a
 * suspected credential theft.
 */
export async function recordSessionRevoked(
  tx: Transaction,
  sessionId: string,
  reason: string,
  at: Date,
): Promise<void> {
  await tx.query(
    `UPDATE sessions
        SET revoked_at = COALESCE(revoked_at, $2),
            revocation_reason = COALESCE(revocation_reason, $3)
      WHERE session_id = $1`,
    [sessionId, at.toISOString(), reason],
  );
}
