import type pg from "pg";
import type { Transaction } from "../database/transaction.js";
import { generateId } from "../ids/generate-id.js";

/**
 * Authentication audit records.
 *
 * Kept apart from ordinary logs (ADR-047): logs are operational and rotate,
 * while "who logged in, from where, and was it refused" is evidence that has
 * to survive. Records carry identifiers and outcomes, never credentials.
 */

export type AuthAuditEventType =
  | "identity_registered"
  | "email_verified"
  | "password_set"
  | "password_sign_in_rejected"
  | "password_reset_requested"
  | "password_reset_completed"
  | "password_changed"
  | "magic_link_requested"
  | "magic_link_consumed"
  | "magic_link_rejected"
  | "session_created"
  | "session_refreshed"
  | "session_refresh_rejected"
  | "session_revoked"
  | "all_sessions_revoked";

export type AuthAuditOutcome = "success" | "failure";

export interface AuthAuditRecord {
  readonly eventType: AuthAuditEventType;
  readonly outcome: AuthAuditOutcome;
  readonly identityId?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly reason?: string | undefined;
  readonly traceId?: string | undefined;
  /** Client-safe context. Must never carry a token, link, or address. */
  readonly context?: Record<string, unknown> | undefined;
}

/**
 * Append an audit record.
 *
 * @param tx - Written inside the caller's transaction, so the record commits
 *   with the change it describes rather than surviving one that rolled back.
 * @param record - What happened, to whom, and whether it succeeded. Must carry
 *   no credential: identifiers, outcomes, and reasons only.
 * @returns Nothing.
 */
export async function recordAuthAudit(tx: Transaction, record: AuthAuditRecord): Promise<void> {
  await tx.query(
    `INSERT INTO auth_audit_events
       (id, event_type, identity_id, session_id, outcome, reason, trace_id, context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      generateId(),
      record.eventType,
      record.identityId ?? null,
      record.sessionId ?? null,
      record.outcome,
      record.reason ?? null,
      record.traceId ?? null,
      record.context === undefined ? null : JSON.stringify(record.context),
    ],
  );
}

/**
 * Read recent audit records for an Identity.
 *
 * Used by security tooling and tests.
 *
 * @param pool - Read-only use; no transaction required.
 * @param identityId - Whose records to read.
 * @param limit - How many, most recent first.
 * @returns The event type, outcome, and reason of each record.
 */
export async function readAuthAudit(
  pool: pg.Pool,
  identityId: string,
  limit = 50,
): Promise<{ eventType: string; outcome: string; reason: string | null }[]> {
  const { rows } = await pool.query<{ event_type: string; outcome: string; reason: string | null }>(
    `SELECT event_type, outcome, reason
       FROM auth_audit_events
      WHERE identity_id = $1
      ORDER BY occurred_at DESC
      LIMIT $2`,
    [identityId, limit],
  );

  return rows.map((row) => ({
    eventType: row.event_type,
    outcome: row.outcome,
    reason: row.reason,
  }));
}
