import type pg from "pg";
import type { Transaction } from "../../../lib/database/transaction.js";

/**
 * Where password hashes live.
 *
 * PostgreSQL rather than event history, because a hash in an immutable stream
 * could never be rotated away and would stay offline-attackable for as long as
 * the stream exists.
 */

/** Read the stored hash for an Identity, if it has one. */
export async function readPasswordHash(
  pool: pg.Pool,
  identityId: string,
): Promise<string | undefined> {
  const { rows } = await pool.query<{ password_hash: string }>(
    `SELECT password_hash FROM identity_passwords WHERE identity_id = $1`,
    [identityId],
  );

  return rows[0]?.password_hash;
}

/**
 * Write or replace an Identity's password.
 *
 * Upsert rather than insert: setting a password is the same operation whether
 * it is the first, a reset, or a change.
 */
export async function writePasswordHash(
  tx: Transaction,
  identityId: string,
  passwordHash: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO identity_passwords (identity_id, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (identity_id)
     DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
    [identityId, passwordHash],
  );
}
