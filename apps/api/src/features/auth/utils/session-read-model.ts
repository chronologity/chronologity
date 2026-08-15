import type { Transaction } from "../../../lib/database/transaction.js";

/**
 * The `sessions` table: what a person sees on their devices screen.
 *
 * Maintained by the command that caused the change rather than by an
 * asynchronous projection, so a session appears in the list immediately after
 * signing in. Safe to write here precisely because this table decides nothing:
 * a lost write costs a row in a list, never an access decision.
 *
 * @param tx - The caller's transaction.
 * @param input - The Session, whose it is, when it began and expires, and the
 *   kind of client.
 * @returns Nothing.
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

/**
 * Record that a Session was refreshed.
 *
 * @param tx - The caller's transaction.
 * @param sessionId - Which Session.
 * @param at - When it was refreshed.
 * @returns Nothing.
 */
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
 *
 * @param tx - The caller's transaction.
 * @param sessionId - Which Session.
 * @param reason - Why it ended.
 * @param at - When.
 * @returns Nothing. The first revocation wins: the reason a Session ended is the
 *   one that ended it, and a later logout must not overwrite evidence of a
 *   suspected theft.
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
