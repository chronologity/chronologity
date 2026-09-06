import {
  sessionCredentialsSchema,
  type SessionCredentials,
} from "@chronologity/contracts";
import { ApiError } from "./api-error.js";
import type { ApiClient } from "./client.js";

/**
 * Holding a signed-in session, and keeping it alive.
 *
 * Before this, `getAccessToken` was a supplier and nobody owned the session: a
 * token expired, the next request was a 401, and every screen had to decide
 * what that meant. Which is how an app signs somebody out for the crime of
 * leaving it open for an hour.
 *
 * **Refreshed before it expires, not after it fails.** The credentials carry
 * `accessTokenExpiresAt`, so waiting for a 401 is choosing to fail one request
 * on purpose. A margin absorbs the round trip and any clock disagreement
 * between the device and the server — a phone whose clock is two minutes fast
 * would otherwise send a token the server has already retired.
 *
 * **Once, however many requests notice at the same moment.** A screen that
 * loads six things on open makes six requests, all of which find the same
 * expired token. Six refreshes would race, and five of them would be spending a
 * refresh token that the first one had already rotated away.
 *
 * **This never touches storage.** Where a refresh token is kept is a mobile
 * decision — `security.md:393` requires platform-secure storage — and belongs
 * to Phase 11. What this offers instead is `onChange`, so whoever owns storage
 * hears about new credentials the moment they exist.
 */

/** What a session needs in order to refresh itself. */
export interface SessionOptions {
  /** Used to make the refresh call. */
  readonly client: ApiClient;
  /** What a sign-in returned, or nothing when nobody is signed in yet. */
  readonly credentials?: SessionCredentials | undefined;
  /**
   * How long before expiry to refresh.
   *
   * Covers the refresh round trip plus clock disagreement between device and
   * server. A minute is generous for the first and modest for the second.
   */
  readonly refreshSkewMs?: number;
  /**
   * Called whenever the credentials change, including when they are cleared.
   *
   * The seam for persistence. It is deliberately not awaited before the token
   * is handed out: a slow write should not delay a request that is already
   * holding a valid token.
   */
  readonly onChange?: (credentials: SessionCredentials | undefined) => void;
  /** The clock, so tests need not wait an hour. */
  readonly now?: () => number;
}

/** A signed-in session that keeps itself current. */
export interface Session {
  /**
   * A token good to send, refreshing first if one is about to expire.
   *
   * @returns The access token, or undefined when nobody is signed in.
   * @throws {ApiError} If refreshing was necessary and the server refused it,
   *   which means the session is over rather than stale.
   */
  accessToken(): Promise<string | undefined>;
  /** What is held now, without refreshing anything. */
  current(): SessionCredentials | undefined;
  /** Adopt credentials, after a sign-in or from storage. */
  adopt(credentials: SessionCredentials): void;
  /** Forget them, after signing out. */
  clear(): void;
  /**
   * Refresh now, whatever the expiry says.
   *
   * @returns Whether a usable token resulted. False rather than throwing when
   *   there is nothing to refresh or the server refused, because the caller for
   *   this is a failed request deciding whether to try again.
   */
  refresh(): Promise<boolean>;
}

const DEFAULT_SKEW_MS = 60_000;

/**
 * Create a session holder.
 *
 * @param options - The client to refresh through, any credentials to start
 *   from, and the seams for persistence and time.
 * @returns The session.
 */
export function createSession(options: SessionOptions): Session {
  const {
    client,
    credentials: initial,
    refreshSkewMs = DEFAULT_SKEW_MS,
    onChange,
    now = Date.now,
  } = options;

  let held: SessionCredentials | undefined = initial;
  /** The refresh in flight, so simultaneous callers share one. */
  let refreshing: Promise<boolean> | undefined;

  const hold = (next: SessionCredentials | undefined): void => {
    held = next;
    onChange?.(next);
  };

  const expiringSoon = (credentials: SessionCredentials): boolean =>
    new Date(credentials.accessTokenExpiresAt).getTime() - now() <= refreshSkewMs;

  const refresh = async (): Promise<boolean> => {
    const current = held;

    if (current === undefined) {
      return false;
    }

    // Started once and shared. The five callers who arrive while the first is
    // in flight must not each spend a refresh token the first has rotated.
    refreshing ??= (async () => {
      try {
        const renewed = await client.request({
          method: "POST",
          path: "/auth/sessions/refresh",
          schema: sessionCredentialsSchema,
          body: { refreshToken: current.refreshToken, sessionId: current.sessionId },
        });

        hold(renewed);

        return true;
      } catch (error) {
        // A refusal means the session is over — revoked, or the refresh token
        // already spent. Holding onto credentials the server has disowned would
        // make every later request fail the same way.
        if (error instanceof ApiError && error.status === 401) {
          hold(undefined);

          return false;
        }

        throw error;
      } finally {
        refreshing = undefined;
      }
    })();

    return refreshing;
  };

  return {
    async accessToken(): Promise<string | undefined> {
      const current = held;

      if (current === undefined) {
        return undefined;
      }

      if (expiringSoon(current)) {
        await refresh();
      }

      return held?.accessToken;
    },
    current: () => held,
    adopt: (credentials) => hold(credentials),
    clear: () => hold(undefined),
    refresh,
  };
}
