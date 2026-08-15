import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import { NotFoundError } from "../../../lib/errors/not-found-error.js";
import { ValidationError } from "../../../lib/errors/validation-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import { decideChangeHandle, USER_CATEGORY } from "../aggregates/user.aggregate.js";
import { clockFor, cooldownFor, type UserDependencies } from "../dependencies.js";
import { checkHandle, describeHandleRejection } from "../handle-policy.js";
import { userEventMetadata } from "../utils/event-metadata.js";
import { claimHandle, releaseHandle } from "../utils/handle-store.js";
import { recordHandleChanged } from "../utils/user-read-model.js";
import { loadUser } from "../utils/user-store.js";
import type { UpdateHandleCommand } from "./update-handle.command.js";

/**
 * Change a handle.
 *
 * The old handle is released and the new one claimed in a single transaction,
 * so the account is never briefly holding both or neither. The released handle
 * enters its cooldown rather than becoming immediately available, because
 * handing a recognisable handle straight to someone else invites impersonation
 * (`identity.md:113`).
 *
 * Nothing else changes. Identity is the user id, so authorship, relationships,
 * and history are untouched (`identity.md:103`).
 *
 * @param deps - Event store, database, and clock.
 * @param command - Whose handle, and the new one.
 * @param context - Trace identifier and receipt time.
 * @returns Nothing.
 * @throws {NotFoundError} If there is no such User.
 * @throws {ValidationError} If the handle is malformed, unavailable, the one
 *   already held, or the account is deactivated.
 */
export async function handleUpdateHandle(
  deps: UserDependencies,
  command: UpdateHandleCommand,
  context: RequestContext,
): Promise<void> {
  const at = clockFor(deps)();
  const { userId, handle } = command.payload;

  const check = checkHandle(handle);

  if (!check.ok) {
    throw new ValidationError(describeHandleRejection(check.reason), { field: "handle" });
  }

  const { state, revision } = await loadUser(deps, userId);
  const decision = decideChangeHandle(state, {
    handle: handle.trim(),
    normalizedHandle: check.normalized,
    now: at,
  });

  if (!decision.ok) {
    if (decision.reason === "user_not_found") {
      throw new NotFoundError("No such account");
    }

    throw new ValidationError(
      decision.reason === "user_deactivated"
        ? "This account is deactivated"
        : "That is already your handle",
      { field: "handle" },
    );
  }

  const previousNormalized = state.normalizedHandle;

  const claimed = await withTransaction(deps.pool, async (tx) => {
    // Released before the new one is claimed, not after. A User may hold only
    // one current handle, so claiming first would briefly leave them holding
    // two and violate that constraint. Both happen in one transaction, so a
    // failed claim rolls the release back and the old handle is never lost.
    if (previousNormalized !== undefined && previousNormalized !== check.normalized) {
      await releaseHandle(tx, previousNormalized, at);
    }

    const claim = await claimHandle(tx, {
      handle: handle.trim(),
      normalizedHandle: check.normalized,
      userId,
      now: at,
      cooldownDays: cooldownFor(deps),
    });

    if (!claim.ok) {
      return false;
    }

    await recordHandleChanged(tx, userId, handle.trim());

    return true;
  });

  if (!claimed) {
    throw new ValidationError("That handle is not available", { field: "handle" });
  }

  await appendEvents({
    client: deps.client,
    streamName: streamName(USER_CATEGORY, userId),
    events: decision.events,
    metadata: userEventMetadata(context, userId),
    expectedRevision: revision,
  });
}
