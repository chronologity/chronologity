import type { Capabilities, GrantableRole, UserRoles } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { withTransaction } from "../../lib/database/transaction.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { UnauthorizedError } from "../../lib/errors/unauthorized-error.js";
import type { RequestContext } from "../../types/request-context.js";
import { UserRepository } from "../users/user.repository.js";
import { effectiveRoles, mayGrantRole, permissionsFor } from "./authorization.policy.js";
import type { AuthorizationRepository } from "./authorization.repository.js";

/**
 * Granting and reading platform roles.
 *
 * Role changes are themselves privileged, and every one of them is evidence:
 * the change and its audit record commit in the same transaction, so a grant
 * nobody can account for later is not a grant that can happen.
 *
 * Whether a role is already held is decided by the write rather than by a read
 * that precedes it. Two administrators granting the same role at the same
 * moment both see it unheld, and only the database can settle which of them
 * actually changed anything.
 */
export class AuthorizationService {
  /** Answers whether the account a role concerns exists at all. */
  private readonly accounts: UserRepository;

  /**
   * Build the Authorization service.
   *
   * @param dataSource - Opens the transactions this service's writes commit in, and
   *   answers whether an account exists.
   * @param roles - Where role assignments and their audit records are stored.
   * @param clock - Injected so tests can move time without waiting.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly roles: AuthorizationRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.accounts = new UserRepository(dataSource);
  }

  /**
   * Grant an elevated role.
   *
   * @param userId - Who is to hold it.
   * @param role - Which role.
   * @param assignedBy - Who is granting it. Undefined means the command line,
   *   where no User is acting.
   * @param reason - Why, recorded on the audit row.
   * @param context - Trace identifier, so the audit row joins up with the
   *   request that caused it.
   * @returns True if the role was granted, false if it was already held. False
   *   is success, not failure: the caller asked for a state that already
   *   obtains, and nothing is written because nothing happened.
   * @throws {NotFoundError} If there is no such account.
   * @throws {UnauthorizedError} If the actor is granting a role to themselves.
   *   Refused however the request reaches here, since a User must never be able
   *   to escalate their own privileges.
   */
  async assign(
    userId: string,
    role: GrantableRole,
    assignedBy: string | undefined,
    reason: string | undefined,
    context: RequestContext,
  ): Promise<boolean> {
    if (!(await this.accounts.exists(userId))) {
      throw new NotFoundError("No such account");
    }

    if (!mayGrantRole(assignedBy, userId)) {
      // Recorded even though it is refused: an attempt to self-escalate is
      // exactly the thing a security review wants to find afterwards.
      await withTransaction(this.dataSource, (tx) =>
        this.roles.recordAudit(tx, {
          eventType: "user_role_assigned",
          outcome: "failure",
          actorUserId: assignedBy,
          subjectUserId: userId,
          role,
          reason: "self_assignment",
          traceId: context.traceId,
        }),
      );

      throw new UnauthorizedError("A role cannot be granted to yourself");
    }

    const at = this.clock();

    return withTransaction(this.dataSource, async (tx) => {
      const granted = await this.roles.assign(tx, { userId, role, assignedBy, at });

      if (granted) {
        await this.roles.recordAudit(tx, {
          eventType: "user_role_assigned",
          outcome: "success",
          actorUserId: assignedBy,
          subjectUserId: userId,
          role,
          reason,
          traceId: context.traceId,
        });
      }

      return granted;
    });
  }

  /**
   * Take an elevated role away.
   *
   * Removing a role from oneself is permitted. The rule against self-service
   * privilege is about escalation; an administrator standing down should not
   * need a second administrator to do it.
   *
   * @param userId - Who is losing it.
   * @param role - Which role.
   * @param removedBy - Who is removing it. Undefined means the command line.
   * @param reason - Why, recorded on the audit row.
   * @param context - Trace identifier.
   * @returns True if the role was removed, false if it was not held. False is
   *   success: the caller asked for a state that already obtains.
   * @throws {NotFoundError} If there is no such account.
   */
  async remove(
    userId: string,
    role: GrantableRole,
    removedBy: string | undefined,
    reason: string | undefined,
    context: RequestContext,
  ): Promise<boolean> {
    if (!(await this.accounts.exists(userId))) {
      throw new NotFoundError("No such account");
    }

    return withTransaction(this.dataSource, async (tx) => {
      const removed = await this.roles.remove(tx, userId, role);

      if (removed) {
        await this.roles.recordAudit(tx, {
          eventType: "user_role_removed",
          outcome: "success",
          actorUserId: removedBy,
          subjectUserId: userId,
          role,
          reason,
          traceId: context.traceId,
        });
      }

      return removed;
    });
  }

  /**
   * Read the elevated roles a User holds, with their provenance.
   *
   * Privileged: who holds moderation authority is not public. The route
   * requires `admin:user-role-manage`.
   *
   * @param userId - Whose roles.
   * @returns The roles held, each with when it was granted and by whom.
   * @throws {NotFoundError} If there is no such account. An account with no
   *   elevated roles returns an empty list, which is a different answer.
   */
  async rolesFor(userId: string): Promise<UserRoles> {
    if (!(await this.accounts.exists(userId))) {
      throw new NotFoundError("No such account");
    }

    return { userId, roles: await this.roles.assignmentsFor(userId) };
  }

  /**
   * Read what the signed-in person may do.
   *
   * A hint for rendering, and nothing more. A client may use it to hide a
   * control nobody can use, which is better than showing a button that fails;
   * but a client that ignores it and calls the endpoint anyway meets the same
   * server-side refusal (`authorization.md:438-444`).
   *
   * @param userId - Whose capabilities.
   * @returns Their roles, baseline included, and the permissions those roles
   *   confer.
   */
  async capabilitiesFor(userId: string): Promise<Capabilities> {
    const roles = effectiveRoles(await this.roles.rolesFor(userId));

    return { userId, roles: [...roles], permissions: [...permissionsFor(roles)] };
  }
}
