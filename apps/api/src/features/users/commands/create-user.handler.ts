import { randomUUID } from "node:crypto";
import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import { ValidationError } from "../../../lib/errors/validation-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import type { EventMetadata } from "../../../types/event-metadata.js";
import { decideCreateUser, initialUserState, USER_CATEGORY } from "../aggregates/user.aggregate.js";
import { checkAge, describeAgeRejection } from "../age-policy.js";
import { clockFor, cooldownFor, minimumAgeFor, type UserDependencies } from "../dependencies.js";
import { checkHandle, describeHandleRejection } from "../handle-policy.js";
import { claimHandle } from "../utils/handle-store.js";
import { recordDateOfBirth } from "../utils/restricted-data-store.js";
import { findUserIdForIdentity, recordUserCreated } from "../utils/user-read-model.js";
import type { CreateUserCommand } from "./create-user.command.js";

/**
 * Create the User for an authenticated Identity.
 *
 * The handle is claimed in the same transaction as the read model, so the
 * database decides who wins when two people reach for the same one. The
 * aggregate is written afterwards: the claim is what must be unique, and the
 * history is what must be auditable.
 *
 * @param deps - Event store, database, and clock.
 * @param command - The Identity, the chosen handle, and the profile.
 * @param context - Trace identifier and receipt time.
 * @returns The new User's identifier.
 * @throws {ValidationError} If the date of birth is not a real date or the
 *   person is below the minimum age, if the handle is malformed, reserved, or
 *   already held, or if this Identity already has a User. "Reserved" and
 *   "held" are reported identically, since which one it is maps out the
 *   reserved list, and an age refusal never states the threshold.
 */
export async function handleCreateUser(
  deps: UserDependencies,
  command: CreateUserCommand,
  context: RequestContext,
): Promise<string> {
  const at = clockFor(deps)();
  const { identityId, handle, displayName, biography, dateOfBirth } = command.payload;

  const existing = await findUserIdForIdentity(deps.pool, identityId);

  if (existing !== undefined) {
    throw new ValidationError("This account has already been created");
  }

  // Checked before the handle, and before anything is written: someone below
  // the minimum should leave no trace beyond the audit of the attempt.
  const minimumAge = minimumAgeFor(deps);
  const age = checkAge(dateOfBirth, minimumAge, at);

  if (!age.ok) {
    // The message never states the threshold. An age gate that answers its own
    // question only teaches people what to type instead.
    throw new ValidationError(describeAgeRejection(age.reason), { field: "dateOfBirth" });
  }

  const check = checkHandle(handle);

  if (!check.ok) {
    throw new ValidationError(describeHandleRejection(check.reason), { field: "handle" });
  }

  const userId = randomUUID();

  const claimed = await withTransaction(deps.pool, async (tx) => {
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

    await recordUserCreated(tx, {
      userId,
      identityId,
      handle: handle.trim(),
      displayName,
      biography,
      createdAt: at,
    });

    // Restricted, and deliberately not part of the event appended below:
    // history is permanent, and a birthdate written there could not be erased.
    await recordDateOfBirth(tx, userId, dateOfBirth, minimumAge);

    return true;
  });

  if (!claimed) {
    throw new ValidationError("That handle is not available", { field: "handle" });
  }

  const decision = decideCreateUser(initialUserState, {
    userId,
    identityId,
    handle: handle.trim(),
    normalizedHandle: check.normalized,
    displayName,
    biography,
    now: at,
  });

  if (decision.ok) {
    const metadata: EventMetadata = {
      traceId: context.traceId,
      correlationId: context.traceId,
      causationId: undefined,
      actorUserId: userId,
      eventVersion: 1,
      recordedAt: context.receivedAt.toISOString(),
    };

    await appendEvents({
      client: deps.client,
      streamName: streamName(USER_CATEGORY, userId),
      events: decision.events,
      metadata,
      expectedRevision: "no_stream",
    });
  }

  return userId;
}
