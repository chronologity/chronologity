import type { GrantableRole } from "@chronologity/contracts";
import type { UserRoleAssigned } from "../events/user-role-assigned.event.js";
import type { UserRoleRemoved } from "../events/user-role-removed.event.js";

/**
 * A User's platform authorization — which elevated roles they hold.
 *
 * A separate aggregate from the User rather than fields on it. Role changes and
 * profile changes have nothing to do with one another, they are made by
 * different people for different reasons, and keeping them apart means reading
 * someone's authorization never means replaying every time they edited their
 * biography (`authorization.md:638`).
 *
 * The baseline `user` role is not represented here. It is what being a User
 * means, and an aggregate that had to record it would be recording the absence
 * of information.
 */

export const USER_AUTHORIZATION_CATEGORY = "userauthorization";

export interface UserAuthorizationState {
  /** Elevated roles currently held. Order is not meaningful. */
  readonly roles: readonly GrantableRole[];
}

export type UserAuthorizationEvent = UserRoleAssigned | UserRoleRemoved;

export const initialUserAuthorizationState: UserAuthorizationState = { roles: [] };

/**
 * Rebuild authorization state from its history.
 *
 * Pure, so replay is deterministic.
 *
 * @param state - State so far.
 * @param event - The next event.
 * @returns The state after applying it; unrecognised types leave it unchanged.
 */
export function evolveUserAuthorization(
  state: UserAuthorizationState,
  event: UserAuthorizationEvent,
): UserAuthorizationState {
  switch (event.type) {
    case "UserRoleAssigned":
      return state.roles.includes(event.payload.role)
        ? state
        : { roles: [...state.roles, event.payload.role] };

    case "UserRoleRemoved":
      return { roles: state.roles.filter((role) => role !== event.payload.role) };

    default:
      return state;
  }
}

export type AuthorizationRejection = "role_already_held" | "role_not_held" | "self_assignment";

export type AuthorizationDecision =
  | { readonly ok: true; readonly events: readonly UserAuthorizationEvent[] }
  | { readonly ok: false; readonly reason: AuthorizationRejection };

/**
 * Grant an elevated role.
 *
 * @param state - The subject's current authorization.
 * @param input - Which role, to whom, at whose hand, why, and when. An
 *   `assignedBy` of undefined means the grant came from the CLI, where no User
 *   was acting.
 * @returns The event to append, or a refusal. Granting a role already held is
 *   refused rather than recorded, since history should say what happened and
 *   nothing did; callers wanting idempotence should treat that refusal as
 *   success. Granting to oneself is refused outright: a User must not be able
 *   to escalate their own privileges (`authorization.md` invariant 22), and
 *   the check belongs here rather than in a route so that no future caller can
 *   route around it.
 */
export function decideAssignRole(
  state: UserAuthorizationState,
  input: {
    userId: string;
    role: GrantableRole;
    assignedBy: string | undefined;
    reason: string | undefined;
    now: Date;
  },
): AuthorizationDecision {
  if (input.assignedBy !== undefined && input.assignedBy === input.userId) {
    return { ok: false, reason: "self_assignment" };
  }

  if (state.roles.includes(input.role)) {
    return { ok: false, reason: "role_already_held" };
  }

  return {
    ok: true,
    events: [
      {
        type: "UserRoleAssigned",
        payload: {
          userId: input.userId,
          role: input.role,
          assignedBy: input.assignedBy,
          reason: input.reason,
          assignedAt: input.now.toISOString(),
        },
      },
    ],
  };
}

/**
 * Take an elevated role away.
 *
 * @param state - The subject's current authorization.
 * @param input - Which role, from whom, at whose hand, why, and when.
 * @returns The event to append, or a refusal if the role is not held.
 *   Removing a role from oneself is permitted: the rule against self-service
 *   privilege is about escalation, and an administrator standing down should
 *   not need a second administrator to do it.
 */
export function decideRemoveRole(
  state: UserAuthorizationState,
  input: {
    userId: string;
    role: GrantableRole;
    removedBy: string | undefined;
    reason: string | undefined;
    now: Date;
  },
): AuthorizationDecision {
  if (!state.roles.includes(input.role)) {
    return { ok: false, reason: "role_not_held" };
  }

  return {
    ok: true,
    events: [
      {
        type: "UserRoleRemoved",
        payload: {
          userId: input.userId,
          role: input.role,
          removedBy: input.removedBy,
          reason: input.reason,
          removedAt: input.now.toISOString(),
        },
      },
    ],
  };
}
