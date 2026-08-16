import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import { NotFoundError } from "../../../lib/errors/not-found-error.js";
import { UnauthorizedError } from "../../../lib/errors/unauthorized-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import { userExists } from "../../users/index.js";
import {
  decideAssignRole,
  USER_AUTHORIZATION_CATEGORY,
} from "../aggregates/user-authorization.aggregate.js";
import { clockFor, type AuthorizationDependencies } from "../dependencies.js";
import { authorizationEventMetadata } from "../utils/event-metadata.js";
import { recordAuthorizationAudit } from "../utils/authorization-audit.js";
import { recordRoleAssigned } from "../utils/authorization-read-model.js";
import { loadUserAuthorization } from "../utils/authorization-store.js";
import type { AssignUserRoleCommand } from "./assign-user-role.command.js";

/**
 * Grant an elevated role.
 *
 * The read model and the audit record commit together, and the event is
 * appended afterwards against the revision the decision was made from. A grant
 * that is not audited is not a grant anyone can account for later.
 *
 * @param deps - Event store, database, and clock.
 * @param command - Who is to hold the role, which role, at whose hand, and why.
 * @param context - Trace identifier and receipt time.
 * @returns True if the role was granted, false if it was already held. False
 *   is success, not failure: the caller asked for a state that already
 *   obtains. Nothing is written in that case, because history should record
 *   what happened and nothing did.
 * @throws {NotFoundError} If there is no such account.
 * @throws {UnauthorizedError} If the actor is granting a role to themselves.
 *   Refused however the request reaches here, since a User must never be able
 *   to escalate their own privileges.
 */
export async function handleAssignUserRole(
  deps: AuthorizationDependencies,
  command: AssignUserRoleCommand,
  context: RequestContext,
): Promise<boolean> {
  const at = clockFor(deps)();
  const { userId, role, assignedBy, reason } = command.payload;

  if (!(await userExists(deps.pool, userId))) {
    throw new NotFoundError("No such account");
  }

  const { state, revision } = await loadUserAuthorization(deps, userId);
  const decision = decideAssignRole(state, { userId, role, assignedBy, reason, now: at });

  if (!decision.ok) {
    if (decision.reason === "role_already_held") {
      return false;
    }

    // Recorded even though it is refused: an attempt to self-escalate is
    // exactly the thing a security review wants to find afterwards.
    await withTransaction(deps.pool, async (tx) => {
      await recordAuthorizationAudit(tx, {
        eventType: "user_role_assigned",
        outcome: "failure",
        actorUserId: assignedBy,
        subjectUserId: userId,
        role,
        reason: "self_assignment",
        traceId: context.traceId,
      });
    });

    throw new UnauthorizedError("A role cannot be granted to yourself");
  }

  await withTransaction(deps.pool, async (tx) => {
    await recordRoleAssigned(tx, { userId, role, assignedBy, at });
    await recordAuthorizationAudit(tx, {
      eventType: "user_role_assigned",
      outcome: "success",
      actorUserId: assignedBy,
      subjectUserId: userId,
      role,
      reason,
      traceId: context.traceId,
    });
  });

  await appendEvents({
    client: deps.client,
    streamName: streamName(USER_AUTHORIZATION_CATEGORY, userId),
    events: decision.events,
    metadata: authorizationEventMetadata(context, assignedBy),
    expectedRevision: revision,
  });

  return true;
}
