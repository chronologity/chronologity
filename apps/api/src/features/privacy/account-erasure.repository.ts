import type { DataSource } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import { ACCOUNT_SWEEPS } from "./account-erasure.js";

/**
 * Removing what an account owns.
 *
 * Executes the table in `account-erasure.ts` rather than describing its own
 * plan, so that what is erased and what is deliberately kept stays readable in
 * one place and checkable against the database.
 *
 * Every statement is keyed on the account and safe to repeat, because erasure
 * is retried by design: a sweep that has already run deletes nothing the second
 * time.
 */
export class AccountErasureRepository {
  /**
   * Build the account erasure repository.
   *
   * @param dataSource - Used for reads. Writes take a transaction.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * How many Moments the account still has.
   *
   * Counts rows rather than undeleted rows: a Moment marked deleted but not yet
   * erased is still a Moment this account owns, and the sweeps must not run
   * while any remain. Erasing one removes its row, so this reaches zero exactly
   * when the account's history is gone.
   *
   * @param userId - Whose account.
   * @returns How many are left.
   */
  async remainingMoments(userId: string): Promise<number> {
    const rows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS count FROM moments WHERE author_user_id = $1`,
      [userId],
    );

    return Number(rows[0]?.count ?? "0");
  }

  /**
   * The next Moments to hand to the Moment erasure path.
   *
   * @param userId - Whose account.
   * @param limit - How many at most, so one run is bounded however long a
   *   history is.
   * @returns Their identifiers, oldest first, so a long history drains in the
   *   order it was recorded rather than in whatever order the database returns.
   */
  async nextMoments(userId: string, limit: number): Promise<string[]> {
    const rows: { moment_id: string }[] = await this.dataSource.query(
      `SELECT moment_id FROM moments
        WHERE author_user_id = $1
        ORDER BY created_at ASC, moment_id ASC
        LIMIT $2`,
      [userId, limit],
    );

    return rows.map((row) => row.moment_id);
  }

  /**
   * The account's uploads that no living Moment holds.
   *
   * @param userId - Whose account.
   * @param limit - How many at most.
   * @returns Their identifiers. A Moment marked deleted does not count as
   *   living, matching the rule the Moment path uses: those are awaiting
   *   erasure themselves, and if each deferred to the other the bytes would
   *   outlive both.
   */
  async orphanedUploads(userId: string, limit: number): Promise<string[]> {
    const rows: { upload_id: string }[] = await this.dataSource.query(
      `SELECT upload.upload_id
         FROM uploads upload
        WHERE upload.owner_user_id = $1
          AND upload.state <> 'deleted'
          AND NOT EXISTS (
                SELECT 1 FROM moment_media media
                  JOIN moments moment ON moment.moment_id = media.moment_id
                 WHERE media.upload_id = upload.upload_id
                   AND moment.deleted_at IS NULL)
        LIMIT $2`,
      [userId, limit],
    );

    return rows.map((row) => row.upload_id);
  }

  /**
   * Run every sweep the plan describes.
   *
   * @param tx - The caller's transaction, so the account's rows go together or
   *   not at all. A half-swept account is one whose data partly survives with
   *   nothing recording which half.
   * @param userId - Whose account.
   * @returns How many rows each sweep affected, keyed by table and column, so a
   *   caller can report it and a test can assert that something actually
   *   happened rather than that nothing failed.
   */
  async sweep(tx: Transaction, userId: string): Promise<Record<string, number>> {
    const affected: Record<string, number> = {};

    for (const step of ACCOUNT_SWEEPS) {
      // Table and column names come from a constant in this repository, never
      // from a caller, which is what makes interpolating them safe. The account
      // identifier — the only untrusted part — is a parameter.
      const statement =
        step.action === "delete"
          ? `WITH swept AS (
               DELETE FROM "${step.table}" WHERE "${step.column}" = $1 RETURNING 1
             ) SELECT COUNT(*)::int AS count FROM swept`
          : `WITH swept AS (
               UPDATE "${step.table}" SET "${step.column}" = NULL
                WHERE "${step.column}" = $1 RETURNING 1
             ) SELECT COUNT(*)::int AS count FROM swept`;

      const rows: { count: number }[] = await tx.query(statement, [userId]);

      affected[`${step.table}.${step.column}`] = rows[0]?.count ?? 0;
    }

    return affected;
  }
}
