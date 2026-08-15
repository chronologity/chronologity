import { readStream } from "../../../lib/eventstore/read-stream.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import {
  evolveIdentity,
  IDENTITY_CATEGORY,
  initialIdentityState,
  type IdentityEvent,
  type IdentityState,
} from "../aggregates/identity.aggregate.js";
import type { AuthDependencies } from "../dependencies.js";

export interface LoadedIdentity {
  readonly state: IdentityState;
  readonly revision: bigint | "no_stream";
}

/** Load an Identity from its authoritative history. */
export async function loadIdentity(
  deps: AuthDependencies,
  identityId: string,
): Promise<LoadedIdentity> {
  const recorded = await readStream(deps.client, streamName(IDENTITY_CATEGORY, identityId));

  let state = initialIdentityState;
  for (const event of recorded) {
    state = evolveIdentity(state, { type: event.type, payload: event.payload } as IdentityEvent);
  }

  const last = recorded[recorded.length - 1];

  return { state, revision: last === undefined ? "no_stream" : last.revision };
}
