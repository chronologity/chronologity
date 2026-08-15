import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import { NotFoundError } from "../../../lib/errors/not-found-error.js";
import { ValidationError } from "../../../lib/errors/validation-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import { decideUpdateProfile, USER_CATEGORY } from "../aggregates/user.aggregate.js";
import { clockFor, type UserDependencies } from "../dependencies.js";
import { userEventMetadata } from "../utils/event-metadata.js";
import { recordProfileUpdated } from "../utils/user-read-model.js";
import { loadUser } from "../utils/user-store.js";
import type { UpdateProfileCommand } from "./update-profile.command.js";

/**
 * Change a display name or biography.
 *
 * @param deps - Event store, database, and clock.
 * @param command - Whose profile, and what to change.
 * @param context - Trace identifier and receipt time.
 * @returns Nothing.
 * @throws {NotFoundError} If there is no such User.
 * @throws {ValidationError} If the account is deactivated, or the change would
 *   alter nothing — history should say what happened, and saving a form
 *   without changing anything did not.
 */
export async function handleUpdateProfile(
  deps: UserDependencies,
  command: UpdateProfileCommand,
  context: RequestContext,
): Promise<void> {
  const at = clockFor(deps)();
  const { userId, displayName, biography } = command.payload;

  const { state, revision } = await loadUser(deps, userId);
  const decision = decideUpdateProfile(state, { displayName, biography, now: at });

  if (!decision.ok) {
    if (decision.reason === "user_not_found") {
      throw new NotFoundError("No such account");
    }

    throw new ValidationError(
      decision.reason === "user_deactivated" ? "This account is deactivated" : "Nothing to update",
    );
  }

  await appendEvents({
    client: deps.client,
    streamName: streamName(USER_CATEGORY, userId),
    events: decision.events,
    metadata: userEventMetadata(context, userId),
    expectedRevision: revision,
  });

  await withTransaction(deps.pool, (tx) =>
    recordProfileUpdated(tx, userId, { displayName, biography }),
  );
}
