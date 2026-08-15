import type { CurrentUser, PublicUser, UpdatePreferencesRequest } from "@chronologity/contracts";
import type pg from "pg";
import type { Transaction } from "../../../lib/database/transaction.js";

/**
 * The `users` and `user_preferences` tables.
 *
 * Maintained by the command that caused the change rather than by an
 * asynchronous projection, so someone sees their own profile immediately after
 * saving it. The aggregate remains the authority for decisions; this is what
 * the product reads.
 */

/** A row as stored, before it becomes either of the public shapes. */
interface UserRow {
  user_id: string;
  handle: string;
  display_name: string;
  biography: string | null;
  status: string;
  created_at: Date;
}

/**
 * Record a newly created User.
 *
 * @param tx - The caller's transaction.
 * @param input - The account, the Identity it belongs to, its handle, display
 *   name, optional biography, and when it was created.
 * @returns Nothing.
 */
export async function recordUserCreated(
  tx: Transaction,
  input: {
    userId: string;
    identityId: string;
    handle: string;
    displayName: string;
    biography: string | undefined;
    createdAt: Date;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO users (user_id, identity_id, handle, display_name, biography, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO NOTHING`,
    [
      input.userId,
      input.identityId,
      input.handle,
      input.displayName,
      input.biography ?? null,
      input.createdAt.toISOString(),
    ],
  );

  // Preferences begin at their defaults rather than absent, so reading them
  // never has to decide what a missing row means.
  await tx.query(
    `INSERT INTO user_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [input.userId],
  );
}

/**
 * Record a profile change.
 *
 * @param tx - The caller's transaction.
 * @param userId - Whose profile.
 * @param input - The fields that changed. Undefined leaves a column alone;
 *   `COALESCE` is what makes that work in one statement.
 * @returns Nothing.
 */
export async function recordProfileUpdated(
  tx: Transaction,
  userId: string,
  input: { displayName?: string | undefined; biography?: string | null | undefined },
): Promise<void> {
  await tx.query(
    `UPDATE users
        SET display_name = COALESCE($2, display_name),
            biography = CASE WHEN $3::boolean THEN $4 ELSE biography END,
            updated_at = now()
      WHERE user_id = $1`,
    [userId, input.displayName ?? null, input.biography !== undefined, input.biography ?? null],
  );
}

/**
 * Record a handle change.
 *
 * @param tx - The caller's transaction.
 * @param userId - Whose handle.
 * @param handle - The new handle, as chosen.
 * @returns Nothing.
 */
export async function recordHandleChanged(
  tx: Transaction,
  userId: string,
  handle: string,
): Promise<void> {
  await tx.query(`UPDATE users SET handle = $2, updated_at = now() WHERE user_id = $1`, [
    userId,
    handle,
  ]);
}

/**
 * Record an account status change.
 *
 * @param tx - The caller's transaction.
 * @param userId - Whose account.
 * @param status - Its new status.
 * @returns Nothing.
 */
export async function recordStatusChanged(
  tx: Transaction,
  userId: string,
  status: "active" | "deactivated",
): Promise<void> {
  await tx.query(`UPDATE users SET status = $2, updated_at = now() WHERE user_id = $1`, [
    userId,
    status,
  ]);
}

/**
 * Apply preference changes.
 *
 * @param tx - The caller's transaction.
 * @param userId - Whose preferences.
 * @param input - Only the preferences being changed; the rest are untouched.
 * @returns Nothing.
 */
export async function recordPreferencesUpdated(
  tx: Transaction,
  userId: string,
  input: UpdatePreferencesRequest,
): Promise<void> {
  await tx.query(
    `UPDATE user_preferences
        SET autoplay_videos = COALESCE($2, autoplay_videos),
            autoplay_sound = COALESCE($3, autoplay_sound),
            locale = CASE WHEN $4::boolean THEN $5 ELSE locale END,
            time_zone = CASE WHEN $6::boolean THEN $7 ELSE time_zone END,
            reduced_motion = COALESCE($8, reduced_motion),
            updated_at = now()
      WHERE user_id = $1`,
    [
      userId,
      input.autoplayVideos ?? null,
      input.autoplaySound ?? null,
      input.locale !== undefined,
      input.locale ?? null,
      input.timeZone !== undefined,
      input.timeZone ?? null,
      input.reducedMotion ?? null,
    ],
  );
}

/**
 * Resolve the Identity signing in to the User it owns.
 *
 * @param pool - Read-only use.
 * @param identityId - The authenticated Identity.
 * @returns Its User, or undefined when account creation has not been
 *   completed. Absence is an ordinary state, not an error.
 */
export async function findUserIdForIdentity(
  pool: pg.Pool,
  identityId: string,
): Promise<string | undefined> {
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM users WHERE identity_id = $1`,
    [identityId],
  );

  return rows[0]?.user_id;
}

/**
 * Read a User as anyone may see them.
 *
 * @param pool - Read-only use.
 * @param userId - Which User.
 * @returns The public view, or undefined if there is no such User or the
 *   account is deactivated. A deactivated account reads as absent rather than
 *   as present-but-hidden, since the difference is not the reader's business.
 */
export async function readPublicUser(
  pool: pg.Pool,
  userId: string,
): Promise<PublicUser | undefined> {
  const { rows } = await pool.query<UserRow>(
    `SELECT user_id, handle, display_name, biography, status, created_at
       FROM users WHERE user_id = $1 AND status = 'active'`,
    [userId],
  );

  const row = rows[0];

  return row === undefined ? undefined : toPublicUser(row);
}

/**
 * A User's own account, minus restricted data.
 *
 * Restricted data is fetched separately and on purpose, so that it can never
 * arrive as a by-product of reading a profile.
 */
export type UserAccountView = Omit<CurrentUser, "dateOfBirth">;

/**
 * Read a User as they see themselves.
 *
 * @param pool - Read-only use.
 * @param userId - Which User.
 * @returns The private view, including status and preferences, or undefined if
 *   there is no such User. Unlike the public view this returns a deactivated
 *   account, since its owner needs to see that in order to reactivate it.
 *   Restricted data is not part of it: this query reads `users`, and restricted
 *   data deliberately does not live there.
 */
export async function readCurrentUser(
  pool: pg.Pool,
  userId: string,
): Promise<UserAccountView | undefined> {
  const { rows } = await pool.query<
    UserRow & {
      autoplay_videos: boolean;
      autoplay_sound: boolean;
      locale: string | null;
      time_zone: string | null;
      reduced_motion: boolean;
    }
  >(
    `SELECT u.user_id, u.handle, u.display_name, u.biography, u.status, u.created_at,
            p.autoplay_videos, p.autoplay_sound, p.locale, p.time_zone, p.reduced_motion
       FROM users u
       JOIN user_preferences p ON p.user_id = u.user_id
      WHERE u.user_id = $1`,
    [userId],
  );

  const row = rows[0];

  if (row === undefined) {
    return undefined;
  }

  return {
    ...toPublicUser(row),
    status: row.status === "deactivated" ? "deactivated" : "active",
    preferences: {
      autoplayVideos: row.autoplay_videos,
      autoplaySound: row.autoplay_sound,
      locale: row.locale,
      timeZone: row.time_zone,
      reducedMotion: row.reduced_motion,
    },
  };
}

/**
 * Shape a stored row as the public view.
 *
 * @param row - The row as stored.
 * @returns The public view. Deliberately narrow: it carries nothing about
 *   authentication and nothing a person has not chosen to present.
 */
function toPublicUser(row: UserRow): PublicUser {
  return {
    userId: row.user_id,
    handle: row.handle,
    displayName: row.display_name,
    biography: row.biography,
    createdAt: row.created_at.toISOString(),
  };
}
