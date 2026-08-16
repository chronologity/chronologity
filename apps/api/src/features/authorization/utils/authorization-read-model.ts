import type { GrantableRole, RoleAssignment } from "@chronologity/contracts";
import type pg from "pg";
import type { Transaction } from "../../../lib/database/transaction.js";

/**
 * Current role assignments.
 *
 * Written in the same transaction as the change it reflects, then the event is
 * appended. Waiting on an asynchronous projection would mean a removed role
 * kept working for as long as the projection lagged, and
 * `authorization.md:563` requires security-sensitive revocation to propagate
 * faster than ordinary derived reads.
 *
 * Only elevated roles are stored. `user` is what being a User means.
 */

/**
 * Read the elevated roles a User holds.
 *
 * On the path of every privileged request, which is why it is one indexed
 * lookup on the primary key rather than a join.
 *
 * @param pool - Read-only use.
 * @param userId - Whose roles.
 * @returns The roles held, or an empty array. An account with no elevated
 *   roles and an account that does not exist are indistinguishable here, and
 *   deliberately so: both mean "holds nothing", which is the answer the
 *   authorization decision needs.
 */
export async function readRolesFor(
  pool: pg.Pool,
  userId: string,
): Promise<readonly GrantableRole[]> {
  const { rows } = await pool.query<{ role: GrantableRole }>(
    `SELECT role FROM authorization_user_roles WHERE user_id = $1 ORDER BY role`,
    [userId],
  );

  return rows.map((row) => row.role);
}

/**
 * Read role assignments with their provenance.
 *
 * @param pool - Read-only use.
 * @param userId - Whose roles.
 * @returns Each role held, when it was granted, and by whom — null where the
 *   grant came from the CLI and no User was acting.
 */
export async function readRoleAssignments(
  pool: pg.Pool,
  userId: string,
): Promise<RoleAssignment[]> {
  const { rows } = await pool.query<{
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
 * Record a granted role.
 *
 * @param tx - The caller's transaction, so the grant, its audit record, and
 *   nothing else commit together.
 * @param input - Who holds it, which role, who granted it, and when.
 * @returns Nothing.
 */
export async function recordRoleAssigned(
  tx: Transaction,
  input: {
    userId: string;
    role: GrantableRole;
    assignedBy: string | undefined;
    at: Date;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO authorization_user_roles (user_id, role, assigned_at, assigned_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, role) DO NOTHING`,
    [input.userId, input.role, input.at.toISOString(), input.assignedBy ?? null],
  );
}

/**
 * Record a removed role.
 *
 * @param tx - The caller's transaction.
 * @param userId - Whose role.
 * @param role - Which one.
 * @returns Nothing. The row is deleted rather than marked: the audit trail and
 *   the event history are where "they used to be a moderator" is recorded, and
 *   keeping a soft-deleted row here would invite a query that forgets to
 *   exclude it — a revoked privilege still working is precisely the failure
 *   this table exists to prevent.
 */
export async function recordRoleRemoved(
  tx: Transaction,
  userId: string,
  role: GrantableRole,
): Promise<void> {
  await tx.query(`DELETE FROM authorization_user_roles WHERE user_id = $1 AND role = $2`, [
    userId,
    role,
  ]);
}
