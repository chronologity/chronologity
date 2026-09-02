import type { GrantableRole } from "@chronologity/contracts";

/** Feature-local types for authorization. */

export type AuthorizationAuditEventType = "user_role_assigned" | "user_role_removed";

export type AuthorizationAuditOutcome = "success" | "failure";

/**
 * Evidence of a privileged change.
 *
 * Written in the same transaction as the change it describes, so it records
 * what happened rather than what was attempted and then rolled back. Refusals
 * are recorded too: an attempt to self-escalate is exactly what a security
 * review goes looking for.
 */
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

/** An audit record as it is read back. */
export interface AuthorizationAuditEntry {
  readonly eventType: string;
  readonly role: string;
  readonly outcome: string;
  readonly actorUserId: string | null;
  readonly reason: string | null;
  readonly traceId: string | null;
}
