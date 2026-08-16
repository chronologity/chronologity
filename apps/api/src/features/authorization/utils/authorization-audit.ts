import type { GrantableRole } from "@chronologity/contracts";
import type pg from "pg";
import type { Transaction } from "../../../lib/database/transaction.js";
import { generateId } from "../../../lib/ids/generate-id.js";

/**
 * Authorization audit records.
 *
 * The same reasoning as `lib/auth/audit.ts`: logs are operational and rotate,
 * while "who was made an administrator, by whom, and why" is evidence that has
 * to survive. Privileged actions are auditable
 * (`authorization.md` invariant 39), and an audit record is only evidence if
 * it commits with the change it describes.
 */

export type AuthorizationAuditEventType = "user_role_assigned" | "user_role_removed";

export type AuthorizationAuditOutcome = "success" | "failure";

export interface AuthorizationAuditRecord {
  readonly eventType: AuthorizationAuditEventType;
  readonly outcome: AuthorizationAuditOutcome;
  /** Absent when the actor is the CLI; the reason records that it was. */
  readonly actorUserId?: string | undefined;
  readonly subjectUserId: string;
  readonly role: GrantableRole;
  readonly reason?: string | undefined;
  readonly traceId?: string | undefined;
  readonly context?: Record<string, unknown> | undefined;
}

/**
 * Append an audit record.
 *
 * @param tx - Written inside the caller's transaction, so the record commits
 *   with the role change it describes rather than surviving one that rolled
 *   back.
 * @param record - Who acted on whom, which role, and whether it succeeded.
 * @returns Nothing.
 */
export async function recordAuthorizationAudit(
  tx: Transaction,
  record: AuthorizationAuditRecord,
): Promise<void> {
  await tx.query(
    `INSERT INTO authorization_audit_events
       (id, event_type, actor_user_id, subject_user_id, role, outcome, reason, trace_id, context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      generateId(),
      record.eventType,
      record.actorUserId ?? null,
      record.subjectUserId,
      record.role,
      record.outcome,
      record.reason ?? null,
      record.traceId ?? null,
      record.context === undefined ? null : JSON.stringify(record.context),
    ],
  );
}

/**
 * Read recent audit records concerning a User.
 *
 * Used by security tooling and tests.
 *
 * @param pool - Read-only use; no transaction required.
 * @param subjectUserId - Whose account the records concern.
 * @param limit - How many, most recent first.
 * @returns What was done, to which role, by whom, and why.
 */
export async function readAuthorizationAudit(
  pool: pg.Pool,
  subjectUserId: string,
  limit = 50,
): Promise<
  {
    eventType: string;
    role: string;
    outcome: string;
    actorUserId: string | null;
    reason: string | null;
    traceId: string | null;
  }[]
> {
  const { rows } = await pool.query<{
    event_type: string;
    role: string;
    outcome: string;
    actor_user_id: string | null;
    reason: string | null;
    trace_id: string | null;
  }>(
    `SELECT event_type, role, outcome, actor_user_id, reason, trace_id
       FROM authorization_audit_events
      WHERE subject_user_id = $1
      ORDER BY occurred_at DESC
      LIMIT $2`,
    [subjectUserId, limit],
  );

  return rows.map((row) => ({
    eventType: row.event_type,
    role: row.role,
    outcome: row.outcome,
    actorUserId: row.actor_user_id,
    reason: row.reason,
    traceId: row.trace_id,
  }));
}
