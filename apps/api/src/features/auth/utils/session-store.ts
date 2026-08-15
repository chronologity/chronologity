import { readStream } from "../../../lib/eventstore/read-stream.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import type { AuthDependencies } from "../dependencies.js";
import {
  evolveSession,
  initialSessionState,
  SESSION_CATEGORY,
  type SessionEvent,
  type SessionState,
} from "../aggregates/session.aggregate.js";

export interface LoadedSession {
  readonly state: SessionState;
  readonly revision: bigint | "no_stream";
}

/**
 * Load a Session from its authoritative history.
 *
 * Used by every path that needs to know whether a Session is still good,
 * including request authentication. Deliberately not served from the `sessions`
 * table: a lagging read model would leave a revoked Session working, and
 * revocation that takes effect eventually is not revocation.
 */
export async function loadSession(
  deps: AuthDependencies,
  sessionId: string,
): Promise<LoadedSession> {
  const recorded = await readStream(deps.client, streamName(SESSION_CATEGORY, sessionId));

  let state = initialSessionState;
  for (const event of recorded) {
    state = evolveSession(state, { type: event.type, payload: event.payload } as SessionEvent);
  }

  const last = recorded[recorded.length - 1];

  return { state, revision: last === undefined ? "no_stream" : last.revision };
}
