import type { Transaction } from "../../../lib/database/transaction.js";

/**
 * Who owns which handle.
 *
 * The unique primary key on the normalised handle is what makes claiming safe
 * under concurrency: two people claiming `@richard` at the same moment both
 * attempt the insert, and the database picks one. Checking availability and
 * then inserting would let both succeed.
 *
 * Handles given up are kept rather than deleted. Releasing one for immediate
 * reassignment invites impersonation and breaks references
 * (`identity.md:113`), so a former handle stays claimed by its original owner
 * for a cooldown. The exact period is configuration because the policy is
 * explicitly open.
 */

/** Why a claim failed. Both are reported to the caller identically. */
export type HandleClaimFailure = "taken" | "reserved_by_cooldown";

export type HandleClaim =
  { readonly ok: true } | { readonly ok: false; readonly reason: HandleClaimFailure };

/**
 * Claim a handle for a User.
 *
 * @param tx - The caller's transaction. The claim and whatever else the
 *   request records must commit together.
 * @param input - The handle in both forms, who is claiming it, the current
 *   instant, and how long a released handle stays reserved.
 * @returns Success, or why the handle is unavailable. A handle previously held
 *   by this same User can always be reclaimed within its own cooldown: the
 *   cooldown exists to protect them from someone else, not from themselves.
 */
export async function claimHandle(
  tx: Transaction,
  input: {
    handle: string;
    normalizedHandle: string;
    userId: string;
    now: Date;
    cooldownDays: number;
  },
): Promise<HandleClaim> {
  const existing = await tx.query<{ user_id: string; released_at: Date | null }>(
    `SELECT user_id, released_at FROM user_handles WHERE normalized_handle = $1`,
    [input.normalizedHandle],
  );

  const row = existing.rows[0];

  if (row !== undefined) {
    if (row.released_at === null) {
      return { ok: false, reason: "taken" };
    }

    const reservedUntil = new Date(
      row.released_at.getTime() + input.cooldownDays * 24 * 60 * 60 * 1000,
    );

    if (row.user_id !== input.userId && reservedUntil > input.now) {
      return { ok: false, reason: "reserved_by_cooldown" };
    }

    // Either this User is taking their own former handle back, or the cooldown
    // has passed and it is genuinely free again.
    await tx.query(
      `UPDATE user_handles
          SET user_id = $2, handle = $3, assigned_at = $4, released_at = NULL
        WHERE normalized_handle = $1`,
      [input.normalizedHandle, input.userId, input.handle, input.now.toISOString()],
    );

    return { ok: true };
  }

  const inserted = await tx.query(
    `INSERT INTO user_handles (normalized_handle, handle, user_id, assigned_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (normalized_handle) DO NOTHING`,
    [input.normalizedHandle, input.handle, input.userId, input.now.toISOString()],
  );

  // The insert conflicted, so someone committed between the read above and
  // this write. They won.
  if ((inserted.rowCount ?? 0) === 0) {
    return { ok: false, reason: "taken" };
  }

  return { ok: true };
}

/**
 * Give up a handle, starting its cooldown.
 *
 * @param tx - The caller's transaction.
 * @param normalizedHandle - The handle being released.
 * @param at - When it was released; the cooldown runs from here.
 * @returns Nothing.
 */
export async function releaseHandle(
  tx: Transaction,
  normalizedHandle: string,
  at: Date,
): Promise<void> {
  await tx.query(`UPDATE user_handles SET released_at = $2 WHERE normalized_handle = $1`, [
    normalizedHandle,
    at.toISOString(),
  ]);
}

/**
 * Find the User currently holding a handle.
 *
 * @param tx - The caller's transaction.
 * @param normalizedHandle - The handle to look up.
 * @returns The owning User, or undefined if nobody currently holds it.
 *   Released handles do not resolve: a former handle must not silently point
 *   at the person who used to have it.
 */
export async function findUserByHandle(
  tx: Transaction,
  normalizedHandle: string,
): Promise<string | undefined> {
  const { rows } = await tx.query<{ user_id: string }>(
    `SELECT user_id FROM user_handles
      WHERE normalized_handle = $1 AND released_at IS NULL`,
    [normalizedHandle],
  );

  return rows[0]?.user_id;
}
