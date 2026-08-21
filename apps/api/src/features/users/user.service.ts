import { randomUUID } from "node:crypto";
import type {
  CreateUserRequest,
  CurrentUser,
  PublicUser,
  UpdatePreferencesRequest,
  UpdateProfileRequest,
} from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { withTransaction } from "../../lib/database/transaction.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import { checkAge, describeAgeRejection } from "./user.age-policy.js";
import { checkHandle, describeHandleRejection, normalizeHandle } from "./user.handle-policy.js";
import { changesNothing, isHandleChange, profileChanges } from "./user.policy.js";
import type { UserRepository } from "./user.repository.js";
import type { UserState } from "./user.types.js";

/**
 * Accounts: who someone is in the product.
 *
 * A User owns presentation and account state — handle, display name,
 * biography, whether the account is active. It does not own credentials,
 * sessions, or email addresses; those belong to the Identity, and duplicating
 * them here is what `authentication.md:213` warns against.
 *
 * Identity is the user id. A handle change alters how someone is referred to
 * and nothing else — not authorship, not relationships, not history
 * (`identity.md:103`) — which is why nothing anywhere refers to a User by
 * handle.
 */

/** Default reservation period for a released handle. */
export const DEFAULT_HANDLE_COOLDOWN_DAYS = 30;

/** Default minimum age. Matches COPPA; jurisdictions requiring more override it. */
export const DEFAULT_MINIMUM_AGE_YEARS = 13;

export interface UserServiceOptions {
  /**
   * How long a released handle stays reserved for its previous holder.
   *
   * Configuration because the policy is explicitly open.
   */
  readonly handleCooldownDays?: number;
  /**
   * Minimum age, in whole years, for creating an account.
   *
   * Configuration because it is a legal question rather than a technical one.
   */
  readonly minimumAgeYears?: number;
  /** Injected so tests can move time without waiting. */
  readonly clock?: () => Date;
}

/** Creating, reading, and changing accounts. */
export class UserService {
  private readonly cooldownDays: number;
  private readonly minimumAge: number;
  private readonly clock: () => Date;

  /**
   * Build the User service.
   *
   * @param dataSource - Opens the transactions this service's writes commit in.
   * @param users - Where accounts, handles, and restricted data are stored.
   * @param options - Handle cooldown, minimum age, and an injectable clock.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UserRepository,
    options: UserServiceOptions = {},
  ) {
    this.cooldownDays = options.handleCooldownDays ?? DEFAULT_HANDLE_COOLDOWN_DAYS;
    this.minimumAge = options.minimumAgeYears ?? DEFAULT_MINIMUM_AGE_YEARS;
    this.clock = options.clock ?? (() => new Date());
  }

  /**
   * Create the User for an authenticated Identity.
   *
   * The handle is claimed in the same transaction as the account itself, so the
   * database decides who wins when two people reach for the same one.
   *
   * @param identityId - The authenticated Identity.
   * @param request - The chosen handle, the profile, and the date of birth.
   * @returns The new User's identifier.
   * @throws {ValidationError} If the date of birth is not a real date or the
   *   person is below the minimum age, if the handle is malformed, reserved, or
   *   already held, or if this Identity already has a User. "Reserved" and
   *   "held" are reported identically, since which one it is maps out the
   *   reserved list, and an age refusal never states the threshold.
   */
  async create(identityId: string, request: CreateUserRequest): Promise<string> {
    const at = this.clock();
    const { handle, displayName, biography, dateOfBirth } = request;

    const existing = await this.users.findIdForIdentity(identityId);

    if (existing !== undefined) {
      throw new ValidationError("This account has already been created");
    }

    // Checked before the handle, and before anything is written: someone below
    // the minimum should leave no trace beyond the audit of the attempt.
    const age = checkAge(dateOfBirth, this.minimumAge, at);

    if (!age.ok) {
      // The message never states the threshold. An age gate that answers its
      // own question only teaches people what to type instead.
      throw new ValidationError(describeAgeRejection(age.reason), { field: "dateOfBirth" });
    }

    const check = checkHandle(handle);

    if (!check.ok) {
      throw new ValidationError(describeHandleRejection(check.reason), { field: "handle" });
    }

    const userId = randomUUID();

    // The account before the handle, because a handle references the account it
    // belongs to. A refused claim throws rather than returning, so the
    // transaction rolls the account back with it and nothing survives a
    // registration that did not complete.
    await withTransaction(this.dataSource, async (tx) => {
      await this.users.insert(tx, {
        userId,
        identityId,
        handle: handle.trim(),
        displayName,
        biography,
        createdAt: at,
      });

      // Restricted, and deliberately in a table of its own: a birthdate must be
      // erasable by a targeted delete rather than buried in a wider row.
      await this.users.recordDateOfBirth(tx, userId, dateOfBirth, this.minimumAge);

      const claim = await this.users.claimHandle(tx, {
        handle: handle.trim(),
        normalizedHandle: check.normalized,
        userId,
        now: at,
        cooldownDays: this.cooldownDays,
      });

      if (!claim.ok) {
        throw new ValidationError("That handle is not available", { field: "handle" });
      }
    });

    return userId;
  }

  /**
   * Change how a User presents themselves.
   *
   * @param userId - Whose profile.
   * @param request - The fields to change. A biography of null clears it;
   *   undefined leaves it alone.
   * @returns Nothing.
   * @throws {NotFoundError} If there is no such User.
   * @throws {ValidationError} If the account is deactivated, or the change
   *   would alter nothing.
   */
  async updateProfile(userId: string, request: UpdateProfileRequest): Promise<void> {
    const state = await this.requireActive(userId);
    const changes = profileChanges(state, request);

    if (changesNothing(changes)) {
      throw new ValidationError("Nothing to update");
    }

    await withTransaction(this.dataSource, (tx) => this.users.updateProfile(tx, userId, changes));
  }

  /**
   * Take a new handle.
   *
   * The old handle is released and the new one claimed in a single transaction,
   * so the account is never briefly holding both or neither. The released
   * handle enters its cooldown rather than becoming immediately available,
   * because handing a recognisable handle straight to someone else invites
   * impersonation (`identity.md:113`).
   *
   * Nothing else changes. Identity is the user id, so authorship,
   * relationships, and history are untouched (`identity.md:103`).
   *
   * @param userId - Whose handle.
   * @param handle - The new one, as chosen.
   * @returns Nothing.
   * @throws {NotFoundError} If there is no such User.
   * @throws {ValidationError} If the handle is malformed, unavailable, the one
   *   already held, or the account is deactivated.
   */
  async updateHandle(userId: string, handle: string): Promise<void> {
    const at = this.clock();
    const check = checkHandle(handle);

    if (!check.ok) {
      throw new ValidationError(describeHandleRejection(check.reason), { field: "handle" });
    }

    const state = await this.requireActive(userId);

    if (!isHandleChange(state.handle, handle.trim())) {
      throw new ValidationError("That is already your handle", { field: "handle" });
    }

    const previousNormalized = normalizeHandle(state.handle);

    const claimed = await withTransaction(this.dataSource, async (tx) => {
      // Released before the new one is claimed, not after. A User may hold only
      // one current handle, so claiming first would briefly leave them holding
      // two and violate that constraint. Both happen in one transaction, so a
      // failed claim rolls the release back and the old handle is never lost.
      if (previousNormalized !== check.normalized) {
        await this.users.releaseHandle(tx, previousNormalized, at);
      }

      const claim = await this.users.claimHandle(tx, {
        handle: handle.trim(),
        normalizedHandle: check.normalized,
        userId,
        now: at,
        cooldownDays: this.cooldownDays,
      });

      if (!claim.ok) {
        return false;
      }

      await this.users.updateHandle(tx, userId, handle.trim());

      return true;
    });

    if (!claimed) {
      throw new ValidationError("That handle is not available", { field: "handle" });
    }
  }

  /**
   * Change someone's preferences.
   *
   * @param userId - Whose preferences.
   * @param request - Only the preferences being changed.
   * @returns Nothing.
   * @throws {NotFoundError} If there is no such User.
   */
  async updatePreferences(userId: string, request: UpdatePreferencesRequest): Promise<void> {
    if (!(await this.users.exists(userId))) {
      throw new NotFoundError("No such account");
    }

    await withTransaction(this.dataSource, (tx) => this.users.updatePreferences(tx, userId, request));
  }

  /**
   * Deactivate an account at its owner's request.
   *
   * @param userId - Whose account.
   * @returns Nothing. Revoking the sessions that were signed in to it is the
   *   caller's next step, and deliberately not this service's: sessions belong
   *   to authentication.
   * @throws {NotFoundError} If there is no such User.
   * @throws {ValidationError} If the account is already deactivated.
   */
  async deactivate(userId: string): Promise<void> {
    if (!(await this.users.exists(userId))) {
      throw new NotFoundError("No such account");
    }

    const moved = await withTransaction(this.dataSource, (tx) =>
      this.users.transitionStatus(tx, userId, "deactivated", "active"),
    );

    if (!moved) {
      throw new ValidationError("This account is already deactivated");
    }
  }

  /**
   * Bring a deactivated account back.
   *
   * @param userId - Whose account.
   * @returns Nothing.
   * @throws {NotFoundError} If there is no such User.
   * @throws {ValidationError} If the account is already active.
   */
  async reactivate(userId: string): Promise<void> {
    if (!(await this.users.exists(userId))) {
      throw new NotFoundError("No such account");
    }

    const moved = await withTransaction(this.dataSource, (tx) =>
      this.users.transitionStatus(tx, userId, "active", "deactivated"),
    );

    if (!moved) {
      throw new ValidationError("This account is already active");
    }
  }

  /**
   * Read the signed-in person's own account, including their preferences.
   *
   * Returns a deactivated account, unlike the public view: its owner needs to
   * see that state in order to reactivate it.
   *
   * @param userId - Which User.
   * @returns Their own view of their account.
   * @throws {NotFoundError} If there is no such User.
   * @throws {Error} If the account has no date of birth recorded, which cannot
   *   happen for an account created through onboarding.
   */
  async getAccount(userId: string): Promise<CurrentUser> {
    const account = await this.users.findAccount(userId);

    if (account === undefined) {
      throw new NotFoundError("No such account");
    }

    // Read separately because it lives in a separate table, which is the point:
    // it cannot arrive by accident in a query written for the profile.
    const dateOfBirth = await this.users.findDateOfBirth(userId);

    if (dateOfBirth === undefined) {
      // Recorded in the same transaction that creates the account, so its
      // absence is not a missing optional field: it is an account that should
      // not exist. Better to fail loudly than to answer with a plausible blank.
      throw new Error(`No restricted data recorded for user ${userId}`);
    }

    return { ...account, dateOfBirth };
  }

  /**
   * Read a User by the handle they currently hold.
   *
   * @param handle - As typed, in any capitalisation.
   * @returns The public view.
   * @throws {NotFoundError} If nobody currently holds that handle, or the
   *   account holding it is deactivated. A former handle does not resolve: it
   *   must not silently point at the person who used to have it.
   */
  async getByHandle(handle: string): Promise<PublicUser> {
    const userId = await this.users.findIdByHandle(normalizeHandle(handle));

    if (userId === undefined) {
      throw new NotFoundError("No such account");
    }

    const user = await this.users.findPublic(userId);

    if (user === undefined) {
      throw new NotFoundError("No such account");
    }

    return user;
  }

  /**
   * Resolve the Identity signing in to the User it owns.
   *
   * @param identityId - The authenticated Identity.
   * @returns Its User, or undefined when account creation has not been
   *   completed. Absence is an ordinary state, not an error.
   */
  async findIdForIdentity(identityId: string): Promise<string | undefined> {
    return this.users.findIdForIdentity(identityId);
  }

  /**
   * Load an account that must exist and be usable.
   *
   * @param userId - Which User.
   * @returns Its stored state.
   * @throws {NotFoundError} If there is no such User.
   * @throws {ValidationError} If the account is deactivated.
   */
  private async requireActive(userId: string): Promise<UserState> {
    const state = await this.users.findState(userId);

    if (state === undefined) {
      throw new NotFoundError("No such account");
    }

    if (state.status === "deactivated") {
      throw new ValidationError("This account is deactivated");
    }

    return state;
  }
}
