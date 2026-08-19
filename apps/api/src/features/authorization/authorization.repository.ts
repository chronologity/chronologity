import type { GrantableRole, RoleAssignment } from "@chronologity/contracts";
import type pg from "pg";
import type { Transaction } from "../../lib/database/transaction.js";
import { generateId } from "../../lib/ids/generate-id.js";
import type { AuthorizationAuditEntry, AuthorizationAuditRecord } from "./authorization.types.js";

/**
 * Role assignments and the evidence for them.
 *
 * Two tables, deliberately. `authorization_user_roles` is what a privileged
 * request is checked against, and it holds only what is true now; the audit
 * table is where "who was made an administrator, by whom, and why" survives.
 * Merging them would mean either a table that grows without bound on the hot
 * path of every privileged request, or evidence that gets deleted when a role
 * is revoked.
 *
 * Only elevated roles are stored. `user` is what being a User means.
 */

/** Reads and writes role assignments. */
export class AuthorizationRepository {
  /**
   * Build the Authorization repository.
   *
   * @param pool - Used for reads. Writes take a transaction, so a role change
   *   and its audit record cannot commit separately.
   */
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Read the elevated roles a User holds.
   *
   * On the path of every privileged request, which is why it is one indexed
   * lookup on the primary key rather than a join.
   *
   * @param userId - Whose roles.
   * @returns The roles held, or an empty array. An account with no elevated
   *   roles and an account that does not exist are indistinguishable here, and
   *   deliberately so: both mean "holds nothing", which is the answer the
   *   authorization decision needs.
   */
  async rolesFor(userId: string): Promise<readonly GrantableRole[]> {
    const { rows } = await this.pool.query<{ role: GrantableRole }>(
      `SELECT role FROM authorization_user_roles WHERE user_id = $1 ORDER BY role`,
      [userId],
    );

    return rows.map((row) => row.role);
  }

  /**
   * Read role assignments with their provenance.
   *
   * @param userId - Whose roles.
   * @returns Each role held, when it was granted, and by whom — null where the
   *   grant came from the CLI and no User was acting.
   */
  async assignmentsFor(userId: string): Promise<RoleAssignment[]> {
    const { rows } = await this.pool.query<{
      role: GrantableRole;
      assigned_at: Date;
      assigned_by: string | null;
    }>(
      `SELECT role, assigned_at, assigned_by
         FROM authorization_user_roles
        WHERE user_id = $1
        ORDER BY assigned_at`,
      [userId],
    );

    return rows.map((row) => ({
      role: row.role,
      assignedAt: row.assigned_at.toISOString(),
      assignedBy: row.assigned_by,
    }));
  }

  /**
   * Grant a role.
   *
   * @param tx - The caller's transaction, so the grant and its audit record
   *   commit together.
   * @param input - Who holds it, which role, who granted it, and when.
   * @returns True if the role was granted, false if it was already held. The
   *   database answers this rather than a prior read: checking first and then
   *   inserting is two moments, and two administrators granting the same role
   *   at once can arrive between them.
   */
  async assign(
    tx: Transaction,
    input: {
      userId: string;
      role: GrantableRole;
      assignedBy: string | undefined;
      at: Date;
    },
  ): Promise<boolean> {
    const { rowCount } = await tx.query(
      `INSERT INTO authorization_user_roles (user_id, role, assigned_at, assigned_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, role) DO NOTHING`,
      [input.userId, input.role, input.at.toISOString(), input.assignedBy ?? null],
    );

    return rowCount === 1;
  }

  /**
   * Take a role away.
   *
   * @param tx - The caller's transaction.
   * @param userId - Whose role.
   * @param role - Which one.
   * @returns True if the role was removed, false if it was not held. The row is
   *   deleted rather than marked: the audit trail is where "they used to be a
   *   moderator" is recorded, and keeping a soft-deleted row here would invite
   *   a query that forgets to exclude it — a revoked privilege still working is
   *   precisely the failure this table exists to prevent.
   */
  async remove(tx: Transaction, userId: string, role: GrantableRole): Promise<boolean> {
    const { rowCount } = await tx.query(
      `DELETE FROM authorization_user_roles WHERE user_id = $1 AND role = $2`,
      [userId, role],
    );

    return rowCount === 1;
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
  async recordAudit(tx: Transaction, record: AuthorizationAuditRecord): Promise<void> {
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
   * @param subjectUserId - Whose account the records concern.
   * @param limit - How many, most recent first.
   * @returns What was done, to which role, by whom, and why.
   */
  async auditFor(subjectUserId: string, limit = 50): Promise<AuthorizationAuditEntry[]> {
    const { rows } = await this.pool.query<{
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
}
