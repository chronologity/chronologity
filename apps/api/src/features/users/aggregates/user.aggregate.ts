import type { UserCreated } from "../events/user-created.event.js";
import type { UserDeactivated } from "../events/user-deactivated.event.js";
import type { UserHandleChanged } from "../events/user-handle-changed.event.js";
import type { UserProfileUpdated } from "../events/user-profile-updated.event.js";
import type { UserReactivated } from "../events/user-reactivated.event.js";

/**
 * User — who someone is in the product.
 *
 * The User owns presentation and account state: handle, display name,
 * biography, and whether the account is active. It does not own credentials,
 * sessions, or email addresses; those belong to the Identity, and duplicating
 * them here is what `authentication.md:213` warns against.
 *
 * Identity is the user id. A handle change alters how someone is referred to
 * and nothing else — not authorship, not relationships, not history
 * (`identity.md:103`) — which is why nothing anywhere refers to a User by
 * handle.
 */

export const USER_CATEGORY = "user";

export type UserStatus = "active" | "deactivated";

export interface UserState {
  readonly exists: boolean;
  readonly userId: string | undefined;
  /** The Identity this account belongs to. Fixed at creation. */
  readonly identityId: string | undefined;
  readonly handle: string | undefined;
  readonly normalizedHandle: string | undefined;
  readonly displayName: string | undefined;
  readonly biography: string | undefined;
  readonly status: UserStatus;
  readonly createdAt: string | undefined;
}

/** Everything that can happen to a User. */
export type UserEvent =
  UserCreated | UserProfileUpdated | UserHandleChanged | UserDeactivated | UserReactivated;

export const initialUserState: UserState = {
  exists: false,
  userId: undefined,
  identityId: undefined,
  handle: undefined,
  normalizedHandle: undefined,
  displayName: undefined,
  biography: undefined,
  status: "active",
  createdAt: undefined,
};

/**
 * Rebuild User state from its history.
 *
 * Pure, so replay is deterministic.
 *
 * @param state - State so far.
 * @param event - The next event.
 * @returns The state after applying it; unrecognised types leave it unchanged.
 */
export function evolveUser(state: UserState, event: UserEvent): UserState {
  switch (event.type) {
    case "UserCreated":
      return {
        ...state,
        exists: true,
        userId: event.payload.userId,
        identityId: event.payload.identityId,
        handle: event.payload.handle,
        normalizedHandle: event.payload.normalizedHandle,
        displayName: event.payload.displayName,
        biography: event.payload.biography,
        status: "active",
        createdAt: event.payload.createdAt,
      };

    case "UserProfileUpdated":
      return {
        ...state,
        displayName: event.payload.displayName ?? state.displayName,
        // Null cleared it; undefined left it alone. Collapsing the two would
        // make it impossible to remove a biography.
        biography:
          event.payload.biography === undefined
            ? state.biography
            : (event.payload.biography ?? undefined),
      };

    case "UserHandleChanged":
      return {
        ...state,
        handle: event.payload.handle,
        normalizedHandle: event.payload.normalizedHandle,
      };

    case "UserDeactivated":
      return { ...state, status: "deactivated" };

    case "UserReactivated":
      return { ...state, status: "active" };

    default:
      return state;
  }
}

export type UserRejection =
  | "user_already_exists"
  | "user_not_found"
  | "user_deactivated"
  | "handle_unchanged"
  | "nothing_to_update"
  | "already_active"
  | "already_deactivated";

export type UserDecision =
  | { readonly ok: true; readonly events: readonly UserEvent[] }
  | { readonly ok: false; readonly reason: UserRejection };

/**
 * Complete account creation.
 *
 * @param state - Must be the initial state; an existing User is refused.
 * @param input - The new account's identifier, the Identity it belongs to, the
 *   chosen handle in both forms, the display name, an optional biography, and
 *   the current instant.
 * @returns The event to append, or a refusal.
 */
export function decideCreateUser(
  state: UserState,
  input: {
    userId: string;
    identityId: string;
    handle: string;
    normalizedHandle: string;
    displayName: string;
    biography: string | undefined;
    now: Date;
  },
): UserDecision {
  if (state.exists) {
    return { ok: false, reason: "user_already_exists" };
  }

  return {
    ok: true,
    events: [
      {
        type: "UserCreated",
        payload: {
          userId: input.userId,
          identityId: input.identityId,
          handle: input.handle,
          normalizedHandle: input.normalizedHandle,
          displayName: input.displayName,
          biography: input.biography,
          createdAt: input.now.toISOString(),
        },
      },
    ],
  };
}

/**
 * Change how a User presents themselves.
 *
 * @param state - The User's current state.
 * @param input - The fields to change and the current instant. A biography of
 *   null clears it; undefined leaves it alone.
 * @returns The event to append, or a refusal. A change that would alter
 *   nothing is refused rather than recorded: history should say what happened,
 *   and "someone saved a form without changing anything" did not.
 */
export function decideUpdateProfile(
  state: UserState,
  input: {
    displayName?: string | undefined;
    biography?: string | null | undefined;
    now: Date;
  },
): UserDecision {
  if (!state.exists) {
    return { ok: false, reason: "user_not_found" };
  }

  if (state.status === "deactivated") {
    return { ok: false, reason: "user_deactivated" };
  }

  const displayNameChanged =
    input.displayName !== undefined && input.displayName !== state.displayName;

  const biographyChanged =
    input.biography !== undefined && (input.biography ?? undefined) !== state.biography;

  if (!displayNameChanged && !biographyChanged) {
    return { ok: false, reason: "nothing_to_update" };
  }

  return {
    ok: true,
    events: [
      {
        type: "UserProfileUpdated",
        payload: {
          displayName: displayNameChanged ? input.displayName : undefined,
          biography: biographyChanged ? (input.biography ?? null) : undefined,
          updatedAt: input.now.toISOString(),
        },
      },
    ],
  };
}

/**
 * Take a new handle.
 *
 * @param state - The User's current state.
 * @param input - The new handle in both forms, and the current instant.
 * @returns The event to append, or a refusal. Claiming the handle already held
 *   is refused, since it would record a change that did not happen; changing
 *   only capitalisation is a real change and is allowed.
 */
export function decideChangeHandle(
  state: UserState,
  input: { handle: string; normalizedHandle: string; now: Date },
): UserDecision {
  if (!state.exists) {
    return { ok: false, reason: "user_not_found" };
  }

  if (state.status === "deactivated") {
    return { ok: false, reason: "user_deactivated" };
  }

  if (state.handle === input.handle) {
    return { ok: false, reason: "handle_unchanged" };
  }

  return {
    ok: true,
    events: [
      {
        type: "UserHandleChanged",
        payload: {
          handle: input.handle,
          normalizedHandle: input.normalizedHandle,
          previousHandle: state.handle ?? "",
          previousNormalizedHandle: state.normalizedHandle ?? "",
          changedAt: input.now.toISOString(),
        },
      },
    ],
  };
}

/**
 * Deactivate an account at its owner's request.
 *
 * @param state - The User's current state.
 * @param input - The current instant.
 * @returns The event to append, or a refusal if the User does not exist or is
 *   already deactivated.
 */
export function decideDeactivate(state: UserState, input: { now: Date }): UserDecision {
  if (!state.exists) {
    return { ok: false, reason: "user_not_found" };
  }

  if (state.status === "deactivated") {
    return { ok: false, reason: "already_deactivated" };
  }

  return {
    ok: true,
    events: [{ type: "UserDeactivated", payload: { deactivatedAt: input.now.toISOString() } }],
  };
}

/**
 * Bring a deactivated account back.
 *
 * @param state - The User's current state.
 * @param input - The current instant.
 * @returns The event to append, or a refusal if the User does not exist or is
 *   already active.
 */
export function decideReactivate(state: UserState, input: { now: Date }): UserDecision {
  if (!state.exists) {
    return { ok: false, reason: "user_not_found" };
  }

  if (state.status === "active") {
    return { ok: false, reason: "already_active" };
  }

  return {
    ok: true,
    events: [{ type: "UserReactivated", payload: { reactivatedAt: input.now.toISOString() } }],
  };
}
