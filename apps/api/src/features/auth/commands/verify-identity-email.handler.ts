import { recordAuthAudit } from "../../../lib/auth/audit.js";
import { consumeMagicLink } from "../../../lib/auth/magic-link.js";
import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import { UnauthenticatedError } from "../../../lib/errors/unauthorized-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import {
  IDENTITY_CATEGORY,
  normalizeEmail,
  type IdentityEvent,
} from "../aggregates/identity.aggregate.js";
import { clockFor, type AuthDependencies } from "../dependencies.js";
import { markEmailVerified } from "../identity-resolution.js";
import { authEventMetadata } from "../utils/event-metadata.js";
import { loadIdentity } from "../utils/identity-store.js";
import type { VerifyIdentityEmailCommand } from "./verify-identity-email.command.js";

/**
 * Redeem a verification link.
 *
 * The link's purpose is `verify_email`, so a sign-in link cannot be used here
 * and this one cannot be used to sign in. Verifying does not create a Session:
 * proving an address and being logged in are separate things, and conflating
 * them would mean a forwarded verification email logs in whoever opens it.
 */
export async function handleVerifyIdentityEmail(
  deps: AuthDependencies,
  command: VerifyIdentityEmailCommand,
  context: RequestContext,
): Promise<void> {
  const at = clockFor(deps)();

  const verified = await withTransaction(deps.pool, async (tx) => {
    const consumed = await consumeMagicLink(tx, {
      token: command.payload.token,
      purpose: "verify_email",
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

    const normalizedEmail = normalizeEmail(consumed.email);
    const identityId = await markEmailVerified(tx, normalizedEmail, at);

    if (identityId === undefined) {
      return undefined;
    }

    await recordAuthAudit(tx, {
      eventType: "email_verified",
      outcome: "success",
      identityId,
      traceId: context.traceId,
    });

    return { identityId, normalizedEmail };
  });

  if (verified === undefined) {
    throw new UnauthenticatedError("Invalid or expired verification link");
  }

  const { state, revision } = await loadIdentity(deps, verified.identityId);
  const alreadyVerified = state.emails.some(
    (entry) => entry.normalizedEmail === verified.normalizedEmail && entry.verified,
  );

  // Verifying twice must not write a second past-tense fact for something that
  // happened once.
  if (alreadyVerified) {
    return;
  }

  const event: IdentityEvent = {
    type: "EmailVerified",
    payload: { normalizedEmail: verified.normalizedEmail, verifiedAt: at.toISOString() },
  };

  await appendEvents({
    client: deps.client,
    streamName: streamName(IDENTITY_CATEGORY, verified.identityId),
    events: [event],
    metadata: authEventMetadata(context, verified.identityId),
    expectedRevision: revision,
  });
}
