import { readStream } from "../../../lib/eventstore/read-stream.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import {
  evolveUserAuthorization,
  initialUserAuthorizationState,
  USER_AUTHORIZATION_CATEGORY,
  type UserAuthorizationEvent,
  type UserAuthorizationState,
} from "../aggregates/user-authorization.aggregate.js";
import type { AuthorizationDependencies } from "../dependencies.js";

export interface LoadedUserAuthorization {
  readonly state: UserAuthorizationState;
  readonly revision: bigint | "no_stream";
}

/**
 * Load a User's authorization from its authoritative history.
 *
 * Short by construction: this stream carries role changes only, so replaying
 * it costs nothing like replaying an account's whole history would.
 *
 * @param deps - Supplies the event store.
 * @param userId - Whose authorization.
 * @returns Its state and the revision that state reflects, so a decision made
 *   from it can be appended against the same revision.
 */
export async function loadUserAuthorization(
  deps: AuthorizationDependencies,
  userId: string,
): Promise<LoadedUserAuthorization> {
  const recorded = await readStream(deps.client, streamName(USER_AUTHORIZATION_CATEGORY, userId));

  let state = initialUserAuthorizationState;
  for (const event of recorded) {
    state = evolveUserAuthorization(state, {
      type: event.type,
      payload: event.payload,
    } as UserAuthorizationEvent);
  }

  const last = recorded[recorded.length - 1];

  return { state, revision: last === undefined ? "no_stream" : last.revision };
}
