import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SessionCredentials } from "@chronologity/contracts";
import { describe, it } from "vitest";
import { ApiError } from "./api-error.js";
import type { ApiClient } from "./client.js";
import { createSession } from "./session.js";

/**
 * Keeping a session alive.
 *
 * Two properties matter here and neither is visible from a single happy-path
 * test. **Refreshing happens before expiry**, because waiting for a 401 is
 * choosing to fail one request on purpose. And **six requests noticing at once
 * cause one refresh**, because five simultaneous refreshes would each spend a
 * token the first had already rotated away.
 */

const NOW = Date.parse("2026-01-01T12:00:00.000Z");

/**
 * Credentials expiring at a chosen distance from now.
 *
 * @param expiresInMs - How far ahead the access token expires.
 * @returns The credentials.
 */
function credentials(expiresInMs: number): SessionCredentials {
  return {
    sessionId: randomUUID(),
    accessToken: `access-${expiresInMs}`,
    accessTokenExpiresAt: new Date(NOW + expiresInMs).toISOString(),
    refreshToken: `refresh-${expiresInMs}`,
    refreshTokenExpiresAt: new Date(NOW + 30 * 86_400_000).toISOString(),
  };
}

/**
 * A client whose refresh call is counted and controllable.
 *
 * @param answer - What the refresh should do.
 * @returns The client and the call log.
 */
function refreshingClient(answer: () => Promise<SessionCredentials>) {
  const calls: unknown[] = [];
  const client = {
    request: async ({ body }: { body?: unknown }) => {
      calls.push(body);

      return answer();
    },
  } as unknown as ApiClient;

  return { client, calls };
}

describe("keeping a session usable", () => {
  it("refreshes before the token expires rather than after it fails", async () => {
    // The whole point. A token with thirty seconds left is refreshed now, not
    // when the next request comes back 401.
    const { client, calls } = refreshingClient(async () => credentials(3_600_000));
    const session = createSession({
      client,
      credentials: credentials(30_000),
      now: () => NOW,
    });

    const token = await session.accessToken();

    assert.equal(calls.length, 1);
    assert.equal(token, "access-3600000");
  });

  it("leaves a token alone while it has life in it", async () => {
    const { client, calls } = refreshingClient(async () => credentials(3_600_000));
    const session = createSession({
      client,
      credentials: credentials(3_600_000),
      now: () => NOW,
    });

    assert.equal(await session.accessToken(), "access-3600000");
    assert.equal(calls.length, 0);
  });

  it("refreshes once when a screen makes six requests at the same moment", async () => {
    // Six simultaneous refreshes would each spend a refresh token the first had
    // already rotated away, and five would fail.
    let settle: ((value: SessionCredentials) => void) | undefined;
    const { client, calls } = refreshingClient(
      () => new Promise<SessionCredentials>((resolve) => (settle = resolve)),
    );
    const session = createSession({ client, credentials: credentials(0), now: () => NOW });

    const six = Array.from({ length: 6 }, () => session.accessToken());

    assert.equal(calls.length, 1, `${calls.length} refreshes for six requests`);

    settle?.(credentials(3_600_000));

    assert.deepEqual(await Promise.all(six), Array.from({ length: 6 }, () => "access-3600000"));
  });

  it("sends both halves of what the route needs", async () => {
    // The contract was missing `sessionId` while the route required it, so a
    // client typed honestly from it could not refresh at all.
    const held = credentials(0);
    const { client, calls } = refreshingClient(async () => credentials(3_600_000));
    const session = createSession({ client, credentials: held, now: () => NOW });

    await session.accessToken();

    assert.deepEqual(calls[0], { refreshToken: held.refreshToken, sessionId: held.sessionId });
  });

  it("tells whoever owns storage about new credentials", async () => {
    // Where a refresh token is kept is a mobile decision. This is the seam.
    const seen: (SessionCredentials | undefined)[] = [];
    const { client } = refreshingClient(async () => credentials(3_600_000));
    const session = createSession({
      client,
      credentials: credentials(0),
      now: () => NOW,
      onChange: (next) => seen.push(next),
    });

    await session.accessToken();

    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.accessToken, "access-3600000");
  });
});

describe("a session that is over", () => {
  it("forgets credentials the server has disowned", async () => {
    // Holding onto them would make every later request fail the same way.
    const { client } = refreshingClient(async () => {
      throw new ApiError(401, { code: "AUTHENTICATION_FAILED", message: "no", traceId: "t" });
    });
    const session = createSession({ client, credentials: credentials(0), now: () => NOW });

    assert.equal(await session.accessToken(), undefined);
    assert.equal(session.current(), undefined);
  });

  it("keeps them when the refresh failed for a reason that is not the session", async () => {
    // A server that was briefly unavailable has not ended anybody's session,
    // and signing them out for it would be the wrong answer to a blip.
    const { client } = refreshingClient(async () => {
      throw new ApiError(503, { code: "PROVIDER_UNAVAILABLE", message: "no", traceId: "t" });
    });
    const session = createSession({ client, credentials: credentials(0), now: () => NOW });

    await assert.rejects(() => session.accessToken());
    assert.notEqual(session.current(), undefined);
  });

  it("has nothing to offer when nobody is signed in", async () => {
    const { client, calls } = refreshingClient(async () => credentials(3_600_000));
    const session = createSession({ client, now: () => NOW });

    assert.equal(await session.accessToken(), undefined);
    assert.equal(calls.length, 0, "it tried to refresh a session that does not exist");
  });

  it("forgets everything when somebody signs out", async () => {
    const { client } = refreshingClient(async () => credentials(3_600_000));
    const session = createSession({ client, credentials: credentials(3_600_000), now: () => NOW });

    session.clear();

    assert.equal(session.current(), undefined);
    assert.equal(await session.accessToken(), undefined);
  });
});
