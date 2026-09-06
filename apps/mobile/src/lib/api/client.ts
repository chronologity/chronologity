import {
  createApiClient,
  createSession,
  type ApiClient,
  type Session,
} from "@chronologity/api-client";
import type { SessionCredentials } from "@chronologity/contracts";
import { randomUUID } from "expo-crypto";
import { forgetSession, rememberSession } from "../storage/secure-storage";

/**
 * The client, and the Session it carries.
 *
 * **Two objects that need each other, built in one place.** The client asks the
 * Session for a token on every request; the Session uses the client to refresh.
 * `getAccessToken` is a callback rather than a value precisely so this can be
 * closed over — the alternative is rebuilding the client every time credentials
 * change, and a screen holding the old one would keep sending a retired token.
 *
 * **Persistence hangs off `onChange`.** ADR-153 left that seam open and said
 * where storage lives "is a mobile decision… and belongs to Phase 11." This is
 * that decision: every change to the credentials — a sign-in, a refresh, a
 * sign-out — writes the refresh half through, and only the refresh half.
 *
 * The write is deliberately not awaited, matching the seam's own contract: a
 * slow keychain must not delay a request already holding a valid token. What
 * that costs is a launch that occasionally finds the previous credential rather
 * than the newest one, which refreshes on first use exactly as a restored
 * Session already does.
 *
 * **The trace generator is supplied here.** ADR-153 made it injectable because
 * React Native has no global `crypto`, and left the header omitted when nothing
 * supplies one. Omitted means a request cannot be followed from this device into
 * the server's logs, which is the whole point of it. `expo-crypto` has the
 * function, so it is passed in.
 */

/** What the application talks to, and what it is signed in as. */
export interface Backend {
  readonly client: ApiClient;
  readonly session: Session;
}

/** What building one needs. */
export interface BackendOptions {
  /** Where the API is. */
  readonly apiUrl: string;
  /** Credentials recovered from the secure store, when there were any. */
  readonly credentials?: SessionCredentials | undefined;
  /** Told whenever the signed-in state changes, so the shell can re-render. */
  readonly onChange?: (credentials: SessionCredentials | undefined) => void;
  /**
   * How to make requests. Defaults to the platform's.
   *
   * A seam for tests, matching the one `createApiClient` already offers, so a
   * test can watch what was sent without reaching into a global.
   */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Build the client and its Session.
 *
 * @param options - The API address, any restored credentials, and a change
 *   listener.
 * @returns Both, already wired to each other.
 */
export function createBackend(options: BackendOptions): Backend {
  const { apiUrl, credentials, onChange, fetch: fetchImpl } = options;

  // The client is built first and refers to a Session it does not yet have.
  // That is sound rather than a trick: `getAccessToken` is a callback, and
  // nothing calls it until a request is made — by which time the line below has
  // run. Building them the other way round is what is impossible.
  const client = createApiClient({
    baseUrl: apiUrl,
    getAccessToken: async () => await session.accessToken(),
    newTraceId: () => randomUUID(),
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });

  const session = createSession({
    client,
    credentials,
    onChange: (next) => {
      void persist(next);
      onChange?.(next);
    },
  });

  return { client, session };
}

/**
 * Write the durable half of a change to the secure store.
 *
 * @param credentials - The new credentials, or undefined when the Session ended.
 * @returns Nothing.
 */
async function persist(credentials: SessionCredentials | undefined): Promise<void> {
  if (credentials === undefined) {
    await forgetSession();

    return;
  }

  await rememberSession({
    sessionId: credentials.sessionId,
    refreshToken: credentials.refreshToken,
    refreshTokenExpiresAt: credentials.refreshTokenExpiresAt,
  });
}
