import type { SessionCredentials } from "@chronologity/contracts";
import { randomUUID } from "node:crypto";
import { recordAuthAudit } from "../../../lib/auth/audit.js";
import { generateRefreshToken, issueAccessToken } from "../../../lib/auth/tokens.js";
import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import type { RequestContext } from "../../../types/request-context.js";
import {
  decideCreateSession,
  initialSessionState,
  SESSION_CATEGORY,
} from "../aggregates/session.aggregate.js";
import type { AuthDependencies } from "../dependencies.js";
import { authEventMetadata } from "./event-metadata.js";
import { toSessionCredentials } from "./issue-credentials.js";
import { UserRepository } from "../../users/user.repository.js";
import { recordSessionCreated } from "./session-read-model.js";

/**
 * Establish a Session for an already-authenticated Identity.
 *
 * Shared by every way of proving who you are. A magic link and a password are
 * different proofs of the same thing, and what follows the proof must be
 * identical — same Session semantics, same rotating refresh credential, same
 * revocation boundary. Two implementations that agree today would not stay
 * that way.
 *
 * The caller is responsible for having actually verified the Identity. This
 * function grants a Session; it does not decide whether one is deserved.
 *
 * @param deps - Event store, database, configuration, and clock.
 * @param input - Whose Session, the kind of client, which proof was accepted, the
 *   request context, and the issuing instant.
 * @returns The new Session's credentials.
 * @throws {Error} If the Session already exists, which can only mean a generated
 *   identifier collided.
 */
export async function issueSessionFor(
  deps: AuthDependencies,
  input: {
    identityId: string;
    clientKind: string | undefined;
    method: "magic_link" | "password";
    context: RequestContext;
    at: Date;
  },
): Promise<SessionCredentials> {
  const sessionId = randomUUID();
  const refresh = generateRefreshToken(deps.config, input.at);

  const decision = decideCreateSession(initialSessionState, {
    sessionId,
    identityId: input.identityId,
    refreshTokenHash: refresh.tokenHash,
    expiresAt: refresh.expiresAt,
    clientKind: input.clientKind,
    now: input.at,
  });

  if (!decision.ok) {
    throw new Error(`Could not create session: ${decision.reason}`);
  }

  await appendEvents({
    client: deps.client,
    streamName: streamName(SESSION_CATEGORY, sessionId),
    events: decision.events,
    metadata: authEventMetadata(input.context, input.identityId),
    expectedRevision: "no_stream",
  });

  // Resolved once, at issue time, rather than on every authenticated request.
  // Someone who completes account creation mid-session obtains a token
  // carrying it on their next refresh; until then the guard falls back to a
  // lookup, so nothing is broken in the meantime.
  const userId = await new UserRepository(deps.pool).findIdForIdentity(input.identityId);

  const access = await issueAccessToken(
    deps.config,
    { identityId: input.identityId, sessionId, userId },
    input.at,
  );

  await withTransaction(deps.pool, async (tx) => {
    await recordSessionCreated(tx, {
      sessionId,
      identityId: input.identityId,
      createdAt: input.at,
      expiresAt: refresh.expiresAt,
      clientKind: input.clientKind,
    });

    await recordAuthAudit(tx, {
      eventType: "session_created",
      outcome: "success",
      identityId: input.identityId,
      sessionId,
      traceId: input.context.traceId,
      // Which proof was accepted is worth keeping: a password sign-in and a
      // link sign-in carry different risk, and telling them apart afterwards
      // requires having recorded it.
      context: { method: input.method },
    });
  });

  return toSessionCredentials({
    sessionId,
    access,
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt,
  });
}
