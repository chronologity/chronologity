import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import { NotFoundError } from "../../../lib/errors/not-found-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import { userExists } from "../../users/index.js";
import {
  decideRemoveRole,
  USER_AUTHORIZATION_CATEGORY,
} from "../aggregates/user-authorization.aggregate.js";
import { clockFor, type AuthorizationDependencies } from "../dependencies.js";
import { recordAuthorizationAudit } from "../utils/authorization-audit.js";
import { recordRoleRemoved } from "../utils/authorization-read-model.js";
import { loadUserAuthorization } from "../utils/authorization-store.js";
import { authorizationEventMetadata } from "../utils/event-metadata.js";
import type { RemoveUserRoleCommand } from "./remove-user-role.command.js";

/**
 * Take an elevated role away.
 *
 * Removing a role from oneself is permitted. The rule against self-service
 * privilege is about escalation; an administrator standing down should not
 * need a second administrator to do it.
 *
 * @param deps - Event store, database, and clock.
 * @param command - Who is losing the role, which role, at whose hand, and why.
 * @param context - Trace identifier and receipt time.
 * @returns True if the role was removed, false if it was not held. False is
 *   success: the caller asked for a state that already obtains.
 * @throws {NotFoundError} If there is no such account.
 */
export async function handleRemoveUserRole(
  deps: AuthorizationDependencies,
  command: RemoveUserRoleCommand,
  context: RequestContext,
): Promise<boolean> {
  const at = clockFor(deps)();
  const { userId, role, removedBy, reason } = command.payload;

  if (!(await userExists(deps.pool, userId))) {
    throw new NotFoundError("No such account");
  }

  const { state, revision } = await loadUserAuthorization(deps, userId);
  const decision = decideRemoveRole(state, { userId, role, removedBy, reason, now: at });

  if (!decision.ok) {
    return false;
  }

  await withTransaction(deps.pool, async (tx) => {
    await recordRoleRemoved(tx, userId, role);
    await recordAuthorizationAudit(tx, {
      eventType: "user_role_removed",
      outcome: "success",
      actorUserId: removedBy,
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
    metadata: authorizationEventMetadata(context, removedBy),
    expectedRevision: revision,
  });

  return true;
}
