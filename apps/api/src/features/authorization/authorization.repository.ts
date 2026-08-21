import type { GrantableRole, RoleAssignment } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import { AuthorizationAuditEvent, RoleAssignment as RoleRow } from "./authorization.model.js";
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
   * @param dataSource - Used for reads. Writes take a transaction, so a role
   *   change and its audit record cannot commit separately.
   */
  constructor(private readonly dataSource: DataSource) {}

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
    const rows = await this.dataSource.getRepository(RoleRow).find({
      where: { userId },
      select: { role: true },
      order: { role: "ASC" },
    });

    return rows.map((row) => row.role as GrantableRole);
  }

  /**
   * Read role assignments with their provenance.
   *
   * @param userId - Whose roles.
   * @returns Each role held, when it was granted, and by whom — null where the
   *   grant came from the CLI and no User was acting.
   */
  async assignmentsFor(userId: string): Promise<RoleAssignment[]> {
    const rows = await this.dataSource.getRepository(RoleRow).find({
      where: { userId },
      select: { role: true, assignedAt: true, assignedBy: true },
      order: { assignedAt: "ASC" },
    });

    return rows.map((row) => ({
      role: row.role as GrantableRole,
      assignedAt: row.assignedAt.toISOString(),
      assignedBy: row.assignedBy,
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
    // `orIgnore` is ON CONFLICT DO NOTHING. A conflicting insert identifies
    // nothing, which is what distinguishes a grant from a role already held.
    const inserted = await tx
      .createQueryBuilder()
      .insert()
      .into(RoleRow)
      .values({
        userId: input.userId,
        role: input.role,
        assignedAt: input.at,
        assignedBy: input.assignedBy ?? null,
      })
      .orIgnore()
      // Explicit, because the identifiers a conflicting insert reports are the
      // ones handed to it rather than the ones written. RETURNING is what
      // actually distinguishes a grant from a role already held.
      .returning(["userId"])
      .execute();

    return (inserted.raw as unknown[]).length === 1;
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
    // Deleting by the composite primary key, so this removes one row or none.
    const { affected } = await tx.delete(RoleRow, { userId, role });

    return affected === 1;
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
    await tx.insert(AuthorizationAuditEvent, {
      id: generateId(),
      occurredAt: new Date(),
      eventType: record.eventType,
      actorUserId: record.actorUserId ?? null,
      subjectUserId: record.subjectUserId,
      role: record.role,
      outcome: record.outcome,
      reason: record.reason ?? null,
      traceId: record.traceId ?? null,
      // The column is `jsonb`, so the driver serialises the value. Absence is a
      // SQL null rather than a JSON one: nothing was recorded, as against
      // something recorded as null.
      context: record.context ?? null,
    });
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
    const rows = await this.dataSource.getRepository(AuthorizationAuditEvent).find({
      where: { subjectUserId },
      select: {
        eventType: true,
        role: true,
        outcome: true,
        actorUserId: true,
        reason: true,
        traceId: true,
      },
      order: { occurredAt: "DESC" },
      take: limit,
    });

    return rows.map((row) => ({
      eventType: row.eventType,
      role: row.role,
      outcome: row.outcome,
      actorUserId: row.actorUserId,
      reason: row.reason,
      traceId: row.traceId,
    }));
  }
}
