import type { SessionCredentials } from "@chronologity/contracts";
import { randomUUID } from "node:crypto";
import { recordAuthAudit } from "../../../lib/auth/audit.js";
import { consumeMagicLink } from "../../../lib/auth/magic-link.js";
import { generateRefreshToken, issueAccessToken } from "../../../lib/auth/tokens.js";
import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents, ConcurrencyConflictError } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import { UnauthenticatedError } from "../../../lib/errors/unauthorized-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import {
  decideCreateIdentity,
  IDENTITY_CATEGORY,
  initialIdentityState,
} from "../aggregates/identity.aggregate.js";
import {
  decideCreateSession,
  initialSessionState,
  SESSION_CATEGORY,
} from "../aggregates/session.aggregate.js";
import { clockFor, type AuthDependencies } from "../dependencies.js";
import { resolveIdentityForEmail } from "../identity-resolution.js";
import { authEventMetadata } from "../utils/event-metadata.js";
import { toSessionCredentials } from "../utils/issue-credentials.js";
import { recordSessionCreated } from "../utils/session-read-model.js";
import type { CreateSessionCommand } from "./create-session.command.js";

/**
 * Redeem a sign-in link and establish a Session.
 *
 * Redeeming the link is itself proof of control of the address, so a first-time
 * address creates an Identity with that email already verified rather than
 * asking someone to confirm what they have just demonstrated.
 *
 * Every way a link can fail — expired, already used, never issued — produces
 * the same refusal, because the differences are precisely what an attacker
 * probes for.
 */
export async function handleCreateSession(
  deps: AuthDependencies,
  command: CreateSessionCommand,
  context: RequestContext,
): Promise<SessionCredentials> {
  const at = clockFor(deps)();

  const resolution = await withTransaction(deps.pool, async (tx) => {
    const consumed = await consumeMagicLink(tx, {
      token: command.payload.token,
      purpose: "login",
      now: at,
    });

    if (consumed === undefined) {
      await recordAuthAudit(tx, {
        eventType: "magic_link_rejected",
        outcome: "failure",
        reason: "invalid_expired_or_consumed",
        traceId: context.traceId,
      });

      return undefined;
    }

    const identity = await resolveIdentityForEmail(tx, { email: consumed.email, now: at });

    await recordAuthAudit(tx, {
      eventType: "magic_link_consumed",
      outcome: "success",
      identityId: identity.identityId,
      traceId: context.traceId,
    });

    return { email: consumed.email, ...identity };
  });

  if (resolution === undefined) {
    throw new UnauthenticatedError("Invalid or expired sign-in link");
  }

  if (resolution.created) {
    await writeIdentityHistory(deps, resolution.identityId, resolution.email, context, at);
  }

  const sessionId = randomUUID();
  const refresh = generateRefreshToken(deps.config, at);

  const decision = decideCreateSession(initialSessionState, {
    sessionId,
    identityId: resolution.identityId,
    refreshTokenHash: refresh.tokenHash,
    expiresAt: refresh.expiresAt,
    clientKind: command.payload.clientKind,
    now: at,
  });

  if (!decision.ok) {
    throw new Error(`Could not create session: ${decision.reason}`);
  }

  await appendEvents({
    client: deps.client,
    streamName: streamName(SESSION_CATEGORY, sessionId),
    events: decision.events,
    metadata: authEventMetadata(context, resolution.identityId),
    expectedRevision: "no_stream",
  });

  const access = await issueAccessToken(
    deps.config,
    { identityId: resolution.identityId, sessionId },
    at,
  );

  await withTransaction(deps.pool, async (tx) => {
    await recordSessionCreated(tx, {
      sessionId,
      identityId: resolution.identityId,
      createdAt: at,
      expiresAt: refresh.expiresAt,
      clientKind: command.payload.clientKind,
    });

    await recordAuthAudit(tx, {
      eventType: "session_created",
      outcome: "success",
      identityId: resolution.identityId,
      sessionId,
      traceId: context.traceId,
    });
  });

  return toSessionCredentials({
    sessionId,
    access,
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt,
  });
}

/**
 * Write the history for a newly claimed Identity.
 *
 * The claim in `identity_emails` has already committed, so a conflict here
 * means the history exists — a retry, or a concurrent request whose claim lost
 * but whose append won. Either way the Identity is established.
 */
async function writeIdentityHistory(
  deps: AuthDependencies,
  identityId: string,
  email: string,
  context: RequestContext,
  at: Date,
): Promise<void> {
  const decision = decideCreateIdentity(initialIdentityState, { identityId, email, now: at });

  if (!decision.ok) {
    return;
  }

  try {
    await appendEvents({
      client: deps.client,
      streamName: streamName(IDENTITY_CATEGORY, identityId),
      events: decision.events,
      metadata: authEventMetadata(context, identityId),
      expectedRevision: "no_stream",
    });
  } catch (error) {
    if (error instanceof ConcurrencyConflictError) {
      deps.logger?.debug({ identityId }, "Identity history already written");
      return;
    }

    throw error;
  }
}
