import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import { NotFoundError } from "../../../lib/errors/not-found-error.js";
import { ValidationError } from "../../../lib/errors/validation-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import { decideReactivate, USER_CATEGORY } from "../aggregates/user.aggregate.js";
import { clockFor, type UserDependencies } from "../dependencies.js";
import { userEventMetadata } from "../utils/event-metadata.js";
import { recordStatusChanged } from "../utils/user-read-model.js";
import { loadUser } from "../utils/user-store.js";
import type { ReactivateUserCommand } from "./reactivate-user.command.js";

/**
 * Reactivate an account.
 *
 * Sessions are not restored. They were ended when the account was deactivated,
 * and reviving credentials that were deliberately revoked would undo the point
 * of revoking them; the person signs in again.
 *
 * @param deps - Event store, database, and clock.
 * @param command - Whose account.
 * @param context - Trace identifier and receipt time.
 * @returns Nothing.
 * @throws {NotFoundError} If there is no such User.
 * @throws {ValidationError} If the account is already active.
 */
export async function handleReactivateUser(
  deps: UserDependencies,
  command: ReactivateUserCommand,
  context: RequestContext,
): Promise<void> {
  const at = clockFor(deps)();
  const { userId } = command.payload;

  const { state, revision } = await loadUser(deps, userId);
  const decision = decideReactivate(state, { now: at });

  if (!decision.ok) {
    if (decision.reason === "user_not_found") {
      throw new NotFoundError("No such account");
    }

    throw new ValidationError("This account is already active");
  }

  await appendEvents({
    client: deps.client,
    streamName: streamName(USER_CATEGORY, userId),
    events: decision.events,
    metadata: userEventMetadata(context, userId),
    expectedRevision: revision,
  });

  await withTransaction(deps.pool, (tx) => recordStatusChanged(tx, userId, "active"));
}
