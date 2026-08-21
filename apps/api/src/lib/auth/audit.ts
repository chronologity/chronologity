import type { DataSource } from "typeorm";
import { AuthAuditEvent } from "../../features/authentication/identity.model.js";
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
  await tx.insert(AuthAuditEvent, {
    id: generateId(),
    occurredAt: new Date(),
    eventType: record.eventType,
    identityId: record.identityId ?? null,
    sessionId: record.sessionId ?? null,
    outcome: record.outcome,
    reason: record.reason ?? null,
    traceId: record.traceId ?? null,
    // The column is `jsonb`, which the driver serialises. Absence is a SQL null
    // rather than a JSON one: nothing was recorded, as against something
    // recorded as null.
    context: record.context ?? null,
  });
}

/**
 * Read recent audit records for an Identity.
 *
 * Used by security tooling and tests.
 *
 * @param dataSource - Read-only use; no transaction required.
 * @param identityId - Whose records to read.
 * @param limit - How many, most recent first.
 * @returns The event type, outcome, and reason of each record.
 */
export async function readAuthAudit(
  dataSource: DataSource,
  identityId: string,
  limit = 50,
): Promise<{ eventType: string; outcome: string; reason: string | null }[]> {
  const rows = await dataSource.getRepository(AuthAuditEvent).find({
    where: { identityId },
    select: { eventType: true, outcome: true, reason: true },
    order: { occurredAt: "DESC" },
    take: limit,
  });

  return rows.map((row) => ({
    eventType: row.eventType,
    outcome: row.outcome,
    reason: row.reason,
  }));
}
