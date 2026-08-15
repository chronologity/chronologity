import { readStream } from "../../../lib/eventstore/read-stream.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import {
  evolveUser,
  initialUserState,
  USER_CATEGORY,
  type UserEvent,
  type UserState,
} from "../aggregates/user.aggregate.js";
import type { UserDependencies } from "../dependencies.js";

export interface LoadedUser {
  readonly state: UserState;
  readonly revision: bigint | "no_stream";
}

/**
 * Load a User from its authoritative history.
 *
 * @param deps - Supplies the event store.
 * @param userId - Which User.
 * @returns Its state and the revision that state reflects, so a decision made
 *   from it can be appended against the same revision.
 */
export async function loadUser(deps: UserDependencies, userId: string): Promise<LoadedUser> {
  const recorded = await readStream(deps.client, streamName(USER_CATEGORY, userId));

  let state = initialUserState;
  for (const event of recorded) {
    state = evolveUser(state, { type: event.type, payload: event.payload } as UserEvent);
  }

  const last = recorded[recorded.length - 1];

  return { state, revision: last === undefined ? "no_stream" : last.revision };
}
