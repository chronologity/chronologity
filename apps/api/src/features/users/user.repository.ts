import type { PublicUser, UpdatePreferencesRequest } from "@chronologity/contracts";
import type pg from "pg";
import type { Transaction } from "../../lib/database/transaction.js";
import { mayClaimReleasedHandle, type HandleClaim } from "./user.handle-policy.js";
import type { UserAccountView, UserState } from "./user.types.js";

/**
 * Accounts, handles, preferences, and restricted data.
 *
 * Four tables, and the separation between them is deliberate rather than
 * incidental. `user_handles` is keyed on the normalised handle so the database
 * decides who wins a race for one; `user_restricted_data` holds a birthdate so
 * that no query written against `users` can return it by accident and so that
 * erasing it is one targeted delete.
 *
 * Reads take the pool and writes take a transaction, so a write's transaction
 * is visible at the call site.
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

/** Reads and writes accounts. */
export class UserRepository {
  /**
   * Build the User repository.
   *
   * @param pool - Used for reads. Writes take a transaction, so a handle claim
   *   and the account that depends on it cannot commit separately.
   */
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Read the stored state a decision is made against.
   *
   * @param userId - Which User.
   * @returns How they present themselves and whether the account is usable, or
   *   undefined if there is no such account.
   */
  async findState(userId: string): Promise<UserState | undefined> {
    const { rows } = await this.pool.query<UserRow>(
      `SELECT user_id, handle, display_name, biography, status, created_at
         FROM users WHERE user_id = $1`,
      [userId],
    );

    const row = rows[0];

    if (row === undefined) {
      return undefined;
    }

    return {
      userId: row.user_id,
      handle: row.handle,
      displayName: row.display_name,
      biography: row.biography,
      status: row.status === "deactivated" ? "deactivated" : "active",
    };
  }

  /**
   * Resolve the Identity signing in to the User it owns.
   *
   * @param identityId - The authenticated Identity.
   * @returns Its User, or undefined when account creation has not been
   *   completed. Absence is an ordinary state, not an error.
   */
  async findIdForIdentity(identityId: string): Promise<string | undefined> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM users WHERE identity_id = $1`,
      [identityId],
    );

    return rows[0]?.user_id;
  }

  /**
   * Whether an account exists at all.
   *
   * Unlike `findPublic` this does not exclude deactivated accounts. Granting or
   * removing a role on a deactivated account is a legitimate administrative
   * act — a role should not silently survive because the account was dormant
   * when someone tried to remove it.
   *
   * @param userId - Which User.
   * @returns True if there is such an account, in any state.
   */
  async exists(userId: string): Promise<boolean> {
    const { rows } = await this.pool.query(`SELECT 1 FROM users WHERE user_id = $1`, [userId]);

    return rows.length > 0;
  }

  /**
   * Read a User as anyone may see them.
   *
   * @param userId - Which User.
   * @returns The public view, or undefined if there is no such User or the
   *   account is deactivated. A deactivated account reads as absent rather than
   *   as present-but-hidden, since the difference is not the reader's business.
   */
  async findPublic(userId: string): Promise<PublicUser | undefined> {
    const { rows } = await this.pool.query<UserRow>(
      `SELECT user_id, handle, display_name, biography, status, created_at
         FROM users WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );

    const row = rows[0];

    return row === undefined ? undefined : toPublicUser(row);
  }

  /**
   * Read a User as they see themselves.
   *
   * @param userId - Which User.
   * @returns The private view, including status and preferences, or undefined
   *   if there is no such User. Unlike the public view this returns a
   *   deactivated account, since its owner needs to see that in order to
   *   reactivate it. Restricted data is not part of it: this reads `users`, and
   *   restricted data deliberately does not live there.
   */
  async findAccount(userId: string): Promise<UserAccountView | undefined> {
    const { rows } = await this.pool.query<
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
   * Record a newly created User.
   *
   * @param tx - The caller's transaction.
   * @param input - The account, the Identity it belongs to, its handle, display
   *   name, optional biography, and when it was created.
   * @returns Nothing.
   */
  async insert(
    tx: Transaction,
    input: {
      userId: string;
      identityId: string;
      handle: string;
      displayName: string;
      biography?: string | undefined;
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
  async updateProfile(
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
   * Record a handle change on the account itself.
   *
   * @param tx - The caller's transaction.
   * @param userId - Whose handle.
   * @param handle - The new handle, as chosen.
   * @returns Nothing.
   */
  async updateHandle(tx: Transaction, userId: string, handle: string): Promise<void> {
    await tx.query(`UPDATE users SET handle = $2, updated_at = now() WHERE user_id = $1`, [
      userId,
      handle,
    ]);
  }

  /**
   * Move an account between active and deactivated.
   *
   * @param tx - The caller's transaction.
   * @param userId - Whose account.
   * @param status - The status it should end in.
   * @param from - The status it must currently be in.
   * @returns True if the account moved. False means it was already in the
   *   target status or does not exist — decided by the statement rather than by
   *   a read that precedes it, so two requests racing cannot both believe they
   *   were the one that changed it.
   */
  async transitionStatus(
    tx: Transaction,
    userId: string,
    status: "active" | "deactivated",
    from: "active" | "deactivated",
  ): Promise<boolean> {
    const { rowCount } = await tx.query(
      `UPDATE users SET status = $2, updated_at = now()
        WHERE user_id = $1 AND status = $3`,
      [userId, status, from],
    );

    return rowCount === 1;
  }

  /**
   * Apply preference changes.
   *
   * @param tx - The caller's transaction.
   * @param userId - Whose preferences.
   * @param input - Only the preferences being changed; the rest are untouched.
   * @returns Nothing.
   */
  async updatePreferences(
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
   * Claim a handle for a User.
   *
   * The unique primary key on the normalised handle is what makes this safe
   * under concurrency: two people claiming `@richard` at the same moment both
   * attempt the insert, and the database picks one. Checking availability and
   * then inserting would let both succeed.
   *
   * @param tx - The caller's transaction. The claim and whatever else the
   *   request records must commit together.
   * @param input - The handle in both forms, who is claiming it, the current
   *   instant, and how long a released handle stays reserved.
   * @returns Success, or why the handle is unavailable.
   */
  async claimHandle(
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

      if (
        !mayClaimReleasedHandle(
          row.released_at,
          row.user_id,
          input.userId,
          input.cooldownDays,
          input.now,
        )
      ) {
        return { ok: false, reason: "reserved_by_cooldown" };
      }

      // Either this User is taking their own former handle back, or the
      // cooldown has passed and it is genuinely free again.
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
  async releaseHandle(tx: Transaction, normalizedHandle: string, at: Date): Promise<void> {
    await tx.query(`UPDATE user_handles SET released_at = $2 WHERE normalized_handle = $1`, [
      normalizedHandle,
      at.toISOString(),
    ]);
  }

  /**
   * Find the User currently holding a handle.
   *
   * @param normalizedHandle - The handle to look up.
   * @returns The owning User, or undefined if nobody currently holds it.
   *   Released handles do not resolve: a former handle must not silently point
   *   at the person who used to have it.
   */
  async findIdByHandle(normalizedHandle: string): Promise<string | undefined> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM user_handles
        WHERE normalized_handle = $1 AND released_at IS NULL`,
      [normalizedHandle],
    );

    return rows[0]?.user_id;
  }

  /**
   * Record a date of birth.
   *
   * Deliberately its own table. Nothing written against `users` can return it
   * by accident, and erasing it is one targeted delete rather than a column
   * update somewhere in a wider row.
   *
   * @param tx - The caller's transaction.
   * @param userId - Whose birthdate.
   * @param dateOfBirth - As given, `YYYY-MM-DD`.
   * @param minimumAgeAtCreation - The threshold in force when the account was
   *   created. Stored alongside, because the threshold is configuration and
   *   without it nobody can say afterwards which rule an account was admitted
   *   under.
   * @returns Nothing.
   */
  async recordDateOfBirth(
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
   * Read a date of birth.
   *
   * @param userId - Whose birthdate.
   * @returns It as `YYYY-MM-DD`, or undefined if none is recorded.
   */
  async findDateOfBirth(userId: string): Promise<string | undefined> {
    const { rows } = await this.pool.query<{ date_of_birth: string }>(
      `SELECT to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth
         FROM user_restricted_data WHERE user_id = $1`,
      [userId],
    );

    return rows[0]?.date_of_birth;
  }
}
