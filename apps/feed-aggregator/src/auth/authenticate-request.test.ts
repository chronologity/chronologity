import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { describe, it } from "vitest";
import type { AuthConfig } from "../config/auth-config.js";
import { UnauthenticatedError } from "../errors/aggregator-error.js";
import { authenticateRequest } from "./authenticate-request.js";
import type { OpenSession, SessionLookup } from "./session.repository.js";

/**
 * Establishing who is asking.
 *
 * The security boundary of a read service. Everything downstream decides what a
 * Viewer may see; this decides which Viewer they are, and a mistake here is not
 * a wrong answer but the wrong person's history.
 *
 * The Session lookup is stubbed rather than mocked away: what is replaced is a
 * repository whose only behaviour is one query, and the query itself is proven
 * against real PostgreSQL in the integration suite. What these tests own is the
 * decision — which combinations authenticate, which refuse, and that refusing
 * never degrades into anonymous.
 */

const IDENTITY = randomUUID();
const SESSION = randomUUID();
const USER = randomUUID();

const SECRET = new TextEncoder().encode("a-secret-long-enough-to-be-accepted");

const config: AuthConfig = {
  jwtSecret: SECRET,
  issuer: "chronologity",
  audience: "chronologity-clients",
};

const now = new Date("2026-09-01T12:00:00.000Z");

/** A lookup that answers with whatever the test decided, and records the ask. */
const repositoryReturning = (
  session: OpenSession | undefined,
): SessionLookup & { readonly asked: string[] } => {
  const asked: string[] = [];

  return {
    asked,
    async findOpen(sessionId: string) {
      asked.push(sessionId);
      return session;
    },
  };
};

interface TokenOptions {
  readonly issuer?: string;
  readonly audience?: string;
  readonly secret?: Uint8Array;
  readonly subject?: string | null;
  readonly sessionId?: unknown;
  readonly userId?: unknown;
  /** A time period jose understands, or an epoch second. */
  readonly expiresAt?: string | number;
}

const tokenFor = async (options: TokenOptions = {}): Promise<string> => {
  const claims: Record<string, unknown> = {};

  if (options.sessionId !== null) {
    claims["sid"] = options.sessionId ?? SESSION;
  }
  if (options.userId !== null) {
    claims["uid"] = options.userId ?? USER;
  }

  let token = new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(options.issuer ?? "chronologity")
    .setAudience(options.audience ?? "chronologity-clients")
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(options.expiresAt ?? "1h");

  if (options.subject !== null) {
    token = token.setSubject(options.subject ?? IDENTITY);
  }

  return token.sign(options.secret ?? SECRET);
};

const bearer = async (options?: TokenOptions): Promise<string> =>
  `Bearer ${await tokenFor(options)}`;

/** Assert the call refused, and refused in the one undifferentiated way. */
const refuses = async (header: string | undefined, sessions: SessionLookup): Promise<void> => {
  await assert.rejects(
    async () => authenticateRequest(header, config, sessions, now),
    (error: unknown) => {
      assert.ok(error instanceof UnauthenticatedError);
      assert.equal(error.message, "Authentication required");
      assert.equal(error.code, "AUTHENTICATION_FAILED");
      return true;
    },
  );
};

describe("authenticateRequest", () => {
  it("treats no credential as an anonymous Viewer rather than a failure", async () => {
    const sessions = repositoryReturning(undefined);

    const viewer = await authenticateRequest(undefined, config, sessions, now);

    assert.deepEqual(viewer, { kind: "anonymous" });
    assert.deepEqual(sessions.asked, []);
  });

  it("treats an empty header as anonymous too", async () => {
    const sessions = repositoryReturning(undefined);

    const viewer = await authenticateRequest("", config, sessions, now);

    assert.deepEqual(viewer, { kind: "anonymous" });
  });

  it("authenticates a verified token whose Session is open", async () => {
    const sessions = repositoryReturning({ identityId: IDENTITY });

    const viewer = await authenticateRequest(await bearer(), config, sessions, now);

    assert.deepEqual(viewer, {
      kind: "authenticated",
      identityId: IDENTITY,
      sessionId: SESSION,
      userId: USER,
    });
  });

  it("authenticates somebody who has not finished creating an account", async () => {
    // A token issued before onboarding carries no `uid`. That is an ordinary
    // state, not a failure, and resolving the User is a later question.
    const sessions = repositoryReturning({ identityId: IDENTITY });

    const viewer = await authenticateRequest(await bearer({ userId: null }), config, sessions, now);

    assert.equal(viewer.kind, "authenticated");
    assert.equal(viewer.kind === "authenticated" ? viewer.userId : "unreachable", undefined);
  });

  it("refuses a scheme other than Bearer", async () => {
    const sessions = repositoryReturning({ identityId: IDENTITY });

    await refuses(`Basic ${await tokenFor()}`, sessions);

    assert.deepEqual(sessions.asked, []);
  });

  it("refuses a header that is not a credential at all", async () => {
    const sessions = repositoryReturning({ identityId: IDENTITY });

    await refuses("nonsense", sessions);
  });

  it("refuses a token signed with another secret", async () => {
    const sessions = repositoryReturning({ identityId: IDENTITY });
    const forged = await bearer({
      secret: new TextEncoder().encode("a-different-secret-entirely"),
    });

    await refuses(forged, sessions);

    assert.deepEqual(sessions.asked, []);
  });

  it("refuses a token from another issuer", async () => {
    const sessions = repositoryReturning({ identityId: IDENTITY });

    await refuses(await bearer({ issuer: "somebody-else" }), sessions);
  });

  it("refuses a token meant for another audience", async () => {
    const sessions = repositoryReturning({ identityId: IDENTITY });

    await refuses(await bearer({ audience: "some-other-client" }), sessions);
  });

  it("refuses an expired token", async () => {
    const sessions = repositoryReturning({ identityId: IDENTITY });

    // 2020-01-01, as an epoch second: jose reads a string as a period from
    // now, so a past instant has to be given as a number.
    await refuses(await bearer({ expiresAt: 1_577_836_800 }), sessions);
  });

  it("refuses a token with no subject", async () => {
    const sessions = repositoryReturning({ identityId: IDENTITY });

    await refuses(await bearer({ subject: null }), sessions);
  });

  it("refuses a token with no Session claim", async () => {
    const sessions = repositoryReturning({ identityId: IDENTITY });

    await refuses(await bearer({ sessionId: null }), sessions);
  });

  it("refuses a Session claim that is not an identifier, without querying for it", async () => {
    // `session_id` is a uuid column, so comparing it against something that is
    // not one raises rather than returning nothing. Refusing first turns what
    // would be an internal error into the refusal it always was.
    const sessions = repositoryReturning({ identityId: IDENTITY });

    await refuses(await bearer({ sessionId: "not-a-uuid" }), sessions);

    assert.deepEqual(sessions.asked, []);
  });

  it("refuses a subject that is not an identifier", async () => {
    const sessions = repositoryReturning({ identityId: IDENTITY });

    await refuses(await bearer({ subject: "not-a-uuid" }), sessions);
  });

  it("refuses when the Session has been revoked or has expired", async () => {
    // The repository reports both the same way, and this is why the lookup
    // exists: the token is still perfectly valid and must stop working anyway.
    const sessions = repositoryReturning(undefined);

    await refuses(await bearer(), sessions);

    assert.deepEqual(sessions.asked, [SESSION]);
  });

  it("refuses a Session belonging to a different Identity than the token claims", async () => {
    const sessions = repositoryReturning({ identityId: randomUUID() });

    await refuses(await bearer(), sessions);
  });

  it("ignores a User claim that is not an identifier rather than refusing", async () => {
    // Unlike the other two claims, this one is optional. A malformed value is
    // treated as absent, which lands the Viewer in the state a token issued
    // before onboarding would — authenticated, with no User yet.
    const sessions = repositoryReturning({ identityId: IDENTITY });

    const viewer = await authenticateRequest(
      await bearer({ userId: "not-a-uuid" }),
      config,
      sessions,
      now,
    );

    assert.equal(viewer.kind, "authenticated");
    assert.equal(viewer.kind === "authenticated" ? viewer.userId : "unreachable", undefined);
  });
});
