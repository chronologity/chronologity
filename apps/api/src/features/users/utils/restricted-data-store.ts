import type pg from "pg";
import type { Transaction } from "../../../lib/database/transaction.js";

/**
 * Restricted personal data.
 *
 * Held apart from the profile so that no query written against `users` can
 * return it by accident, and so that erasing it is one targeted delete rather
 * than a column update someone has to remember.
 */

/**
 * Record a date of birth, with the threshold it was admitted under.
 *
 * @param tx - The caller's transaction, so it commits with the account itself.
 * @param userId - Whose data.
 * @param dateOfBirth - A calendar date, as `YYYY-MM-DD`.
 * @param minimumAgeAtCreation - The minimum in force at the time. Kept because
 *   the threshold is configuration: without it, nobody can say afterwards
 *   which rule an account was admitted under.
 * @returns Nothing.
 */
export async function recordDateOfBirth(
  tx: Transaction,
  userId: string,
  dateOfBirth: string,
  minimumAgeAtCreation: number,
): Promise<void> {
  await tx.query(
    `INSERT INTO user_restricted_data (user_id, date_of_birth, minimum_age_at_creation)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, dateOfBirth, minimumAgeAtCreation],
  );
}

/**
 * Read someone's date of birth.
 *
 * Only ever for the person it belongs to, or for answering a regulator about a
 * specific account. Nothing public reads this.
 *
 * @param pool - Read-only use.
 * @param userId - Whose data.
 * @returns The date as `YYYY-MM-DD`, or undefined if none is held.
 */
export async function readDateOfBirth(pool: pg.Pool, userId: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ date_of_birth: string }>(
    `SELECT to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth
       FROM user_restricted_data WHERE user_id = $1`,
    [userId],
  );

  return rows[0]?.date_of_birth;
}
