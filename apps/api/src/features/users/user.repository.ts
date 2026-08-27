import type { PublicUser, UpdatePreferencesRequest } from "@chronologity/contracts";
import { IsNull, type DataSource } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import { Handle, Preferences, RestrictedData, User } from "./user.model.js";
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
 * Reads take the DataSource and writes take a transaction, so a write's
 * transaction is visible at the call site.
 */

/**
 * Shape a stored row as the public view.
 *
 * @param row - The row as stored.
 * @returns The public view. Deliberately narrow: it carries nothing about
 *   authentication and nothing a person has not chosen to present.
 */
export function toPublicUser(row: User): PublicUser {
  return {
    userId: row.userId,
    handle: row.handle,
    displayName: row.displayName,
    biography: row.biography,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Read a stored status as one of the three the application recognises.
 *
 * @param status - As stored.
 * @returns The status, treating anything unrecognised as suspended. That
 *   default changed when suspension arrived: while there were two values,
 *   falling back to active was harmless, and now the fallback decides whether
 *   somebody Chronologity has restricted goes on writing. A value outside the
 *   three would be a database that no longer matches its migrations, and the
 *   safe reading of a database in that condition is the restrictive one.
 */
function toStatus(status: string): "active" | "deactivated" | "suspended" {
  switch (status) {
    case "active":
      return "active";
    case "deactivated":
      return "deactivated";
    default:
      return "suspended";
  }
}

/** Reads and writes accounts. */
export class UserRepository {
  /**
   * Build the User repository.
   *
   * @param dataSource - Used for reads. Writes take a transaction, so a handle
   *   claim and the account that depends on it cannot commit separately.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Read the stored state a decision is made against.
   *
   * @param userId - Which User.
   * @returns How they present themselves and whether the account is usable, or
   *   undefined if there is no such account.
   */
  async findState(userId: string): Promise<UserState | undefined> {
    const row = await this.dataSource.getRepository(User).findOneBy({ userId });

    if (row === null) {
      return undefined;
    }

    return {
      userId: row.userId,
      handle: row.handle,
      displayName: row.displayName,
      biography: row.biography,
      status: toStatus(row.status),
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
    const row = await this.dataSource
      .getRepository(User)
      .findOne({ where: { identityId }, select: { userId: true } });

    return row?.userId;
  }

  /**
   * The Identity an account signs in with.
   *
   * The reverse of `findIdForIdentity`, and needed wherever something has to
   * reach a person outside the application: an account holds no address of its
   * own, because addresses belong to the Identity that proves who is asking.
   *
   * @param userId - The account.
   * @returns Its Identity, or undefined when there is no such account.
   */
  async findIdentityForId(userId: string): Promise<string | undefined> {
    const row = await this.dataSource
      .getRepository(User)
      .findOne({ where: { userId }, select: { identityId: true } });

    return row?.identityId;
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
    return this.dataSource.getRepository(User).existsBy({ userId });
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
    const row = await this.dataSource
      .getRepository(User)
      .findOneBy({ userId, status: "active" });

    return row === null ? undefined : toPublicUser(row);
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
    const row = await this.dataSource
      .getRepository(User)
      .findOne({ where: { userId }, relations: { preferences: true } });

    // Preferences are written with the account and never removed, so their
    // absence means the account is not fully created. Reported as absent rather
    // than filled in with defaults, which would present an account that does
    // not exist as one that does.
    if (row === null || row.preferences === undefined) {
      return undefined;
    }

    return {
      ...toPublicUser(row),
      status: toStatus(row.status),
      preferences: {
        autoplayVideos: row.preferences.autoplayVideos,
        autoplaySound: row.preferences.autoplaySound,
        locale: row.preferences.locale,
        timeZone: row.preferences.timeZone,
        reducedMotion: row.preferences.reducedMotion,
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
    await tx
      .createQueryBuilder()
      .insert()
      .into(User)
      .values({
        userId: input.userId,
        identityId: input.identityId,
        handle: input.handle,
        displayName: input.displayName,
        biography: input.biography ?? null,
        status: "active",
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      })
      .orIgnore()
      .execute();

    // Preferences begin at their defaults rather than absent, so reading them
    // never has to decide what a missing row means. The columns the database
    // defaults are left out here so there is one definition of each default.
    await tx
      .createQueryBuilder()
      .insert()
      .into(Preferences)
      .values({ userId: input.userId, updatedAt: input.createdAt })
      .orIgnore()
      .execute();
  }

  /**
   * Record a profile change.
   *
   * @param tx - The caller's transaction.
   * @param userId - Whose profile.
   * @param input - The fields that changed. A field left undefined is left
   *   alone; one given as null is cleared. The difference is carried by whether
   *   the key is present, so it survives all the way to the statement.
   * @returns Nothing.
   */
  async updateProfile(
    tx: Transaction,
    userId: string,
    input: { displayName?: string | undefined; biography?: string | null | undefined },
  ): Promise<void> {
    await tx.update(
      User,
      { userId },
      {
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
        ...(input.biography === undefined ? {} : { biography: input.biography }),
        updatedAt: new Date(),
      },
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
    await tx.update(User, { userId }, { handle, updatedAt: new Date() });
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
    // The current status is part of the WHERE clause rather than something read
    // first, which is what makes this one atomic statement.
    const { affected } = await tx.update(
      User,
      { userId, status: from },
      { status, updatedAt: new Date() },
    );

    return affected === 1;
  }

  /**
   * Apply preference changes.
   *
   * @param tx - The caller's transaction.
   * @param userId - Whose preferences.
   * @param input - Only the preferences being changed; the rest are untouched.
   *   As with a profile change, undefined leaves a preference alone and null
   *   clears one.
   * @returns Nothing.
   */
  async updatePreferences(
    tx: Transaction,
    userId: string,
    input: UpdatePreferencesRequest,
  ): Promise<void> {
    await tx.update(
      Preferences,
      { userId },
      {
        ...(input.autoplayVideos === undefined ? {} : { autoplayVideos: input.autoplayVideos }),
        ...(input.autoplaySound === undefined ? {} : { autoplaySound: input.autoplaySound }),
        ...(input.locale === undefined ? {} : { locale: input.locale }),
        ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
        ...(input.reducedMotion === undefined ? {} : { reducedMotion: input.reducedMotion }),
        updatedAt: new Date(),
      },
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
   * Three ways a claim succeeds, and they are not the same thing. The handle is
   * unheld; or it was released and is being taken back by its previous holder
   * or has outlived its cooldown; or it is already held by whoever is claiming
   * it, which is a change of capitalisation rather than an acquisition.
   *
   * @param tx - The caller's transaction. The claim and whatever else the
   *   request records must commit together.
   * @param input - The handle in both forms, who is claiming it, the current
   *   instant, and how long a released handle stays reserved.
   * @returns Success, or why the handle is unavailable. A handle held by the
   *   claimant is never unavailable to them: it is restyled in place, and the
   *   moment it was acquired is left alone because it was not acquired again.
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
    const row = await tx.findOne(Handle, {
      where: { normalizedHandle: input.normalizedHandle },
      select: { userId: true, releasedAt: true },
    });

    if (row !== null) {
      if (row.releasedAt === null) {
        if (row.userId !== input.userId) {
          return { ok: false, reason: "taken" };
        }

        // Held by whoever is claiming it. A handle is not taken from its own
        // holder, so this is a restyle — `Richard` for `richard` — which
        // changes how the handle is written and nothing else. The moment it
        // was acquired stands, because it was not acquired again.
        await tx.update(
          Handle,
          { normalizedHandle: input.normalizedHandle },
          { handle: input.handle },
        );

        return { ok: true };
      }

      if (
        !mayClaimReleasedHandle(
          row.releasedAt,
          row.userId,
          input.userId,
          input.cooldownDays,
          input.now,
        )
      ) {
        return { ok: false, reason: "reserved_by_cooldown" };
      }

      // Either this User is taking their own former handle back, or the
      // cooldown has passed and it is genuinely free again.
      await tx.update(
        Handle,
        { normalizedHandle: input.normalizedHandle },
        {
          userId: input.userId,
          handle: input.handle,
          assignedAt: input.now,
          releasedAt: null,
        },
      );

      return { ok: true };
    }

    // `orIgnore` is ON CONFLICT DO NOTHING. RETURNING nothing means someone
    // committed between the read above and this write, and they won — the
    // identifiers a conflicting insert reports are the ones handed to it, so
    // only what came back from the database can answer this.
    const inserted = await tx
      .createQueryBuilder()
      .insert()
      .into(Handle)
      .values({
        normalizedHandle: input.normalizedHandle,
        handle: input.handle,
        userId: input.userId,
        assignedAt: input.now,
        releasedAt: null,
      })
      .orIgnore()
      .returning(["normalizedHandle"])
      .execute();

    if ((inserted.raw as unknown[]).length !== 1) {
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
    await tx.update(Handle, { normalizedHandle }, { releasedAt: at });
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
    const row = await this.dataSource
      .getRepository(Handle)
      .findOne({ where: { normalizedHandle, releasedAt: IsNull() }, select: { userId: true } });

    return row?.userId;
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
    await tx
      .createQueryBuilder()
      .insert()
      .into(RestrictedData)
      // A `date` column, which the driver reads and writes as `YYYY-MM-DD`
      // rather than as an instant. Kept as a string throughout, so no timezone
      // ever gets a chance to move the day.
      .values({ userId, dateOfBirth, minimumAgeAtCreation, recordedAt: new Date() })
      .orIgnore()
      .execute();
  }

  /**
   * Read a date of birth.
   *
   * @param userId - Whose birthdate.
   * @returns It as `YYYY-MM-DD`, or undefined if none is recorded.
   */
  async findDateOfBirth(userId: string): Promise<string | undefined> {
    const row = await this.dataSource
      .getRepository(RestrictedData)
      .findOne({ where: { userId }, select: { dateOfBirth: true } });

    return row?.dateOfBirth;
  }
}
