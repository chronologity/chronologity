import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import { NotFoundError } from "../../../lib/errors/not-found-error.js";
import { ValidationError } from "../../../lib/errors/validation-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import type { AuthDependencies } from "../../auth/dependencies.js";
import { revokeAllUserSessions } from "../../auth/commands/revoke-all-user-sessions.command.js";
import { handleRevokeAllUserSessions } from "../../auth/commands/revoke-all-user-sessions.handler.js";
import { decideDeactivate, USER_CATEGORY } from "../aggregates/user.aggregate.js";
import { clockFor, type UserDependencies } from "../dependencies.js";
import { userEventMetadata } from "../utils/event-metadata.js";
import { recordStatusChanged } from "../utils/user-read-model.js";
import { loadUser } from "../utils/user-store.js";
import type { DeactivateUserCommand } from "./deactivate-user.command.js";

/**
 * Deactivate an account.
 *
 * Every Session ends with it. Deactivating an account while leaving its
 * sessions alive would make the state cosmetic — the person would still be
 * signed in everywhere they already were.
 *
 * Distinct from suspension, which someone else imposes and which belongs to
 * moderation, and from deletion, which removes rather than pauses.
 *
 * @param deps - Event store, database, and clock.
 * @param auth - Supplies session revocation, which the auth feature owns.
 * @param command - Whose account, and the Identity behind it.
 * @param context - Trace identifier and receipt time.
 * @returns How many Sessions were revoked.
 * @throws {NotFoundError} If there is no such User.
 * @throws {ValidationError} If the account is already deactivated.
 */
export async function handleDeactivateUser(
  deps: UserDependencies,
  auth: AuthDependencies,
  command: DeactivateUserCommand,
  context: RequestContext,
): Promise<number> {
  const at = clockFor(deps)();
  const { userId, identityId } = command.payload;

  const { state, revision } = await loadUser(deps, userId);
  const decision = decideDeactivate(state, { now: at });

  if (!decision.ok) {
    if (decision.reason === "user_not_found") {
      throw new NotFoundError("No such account");
    }

    throw new ValidationError("This account is already deactivated");
  }

  await appendEvents({
    client: deps.client,
    streamName: streamName(USER_CATEGORY, userId),
    events: decision.events,
    metadata: userEventMetadata(context, userId),
    expectedRevision: revision,
  });

  await withTransaction(deps.pool, (tx) => recordStatusChanged(tx, userId, "deactivated"));

  return handleRevokeAllUserSessions(
    auth,
    revokeAllUserSessions(identityId, "account_deactivated"),
    context,
  );
}
