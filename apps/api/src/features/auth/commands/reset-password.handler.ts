import { recordAuthAudit } from "../../../lib/auth/audit.js";
import { consumeMagicLink } from "../../../lib/auth/magic-link.js";
import { hashPassword } from "../../../lib/auth/password.js";
import { checkPassword, describeRejection } from "../../../lib/auth/password-policy.js";
import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import { UnauthenticatedError } from "../../../lib/errors/unauthorized-error.js";
import { ValidationError } from "../../../lib/errors/validation-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import {
  decideSetPassword,
  IDENTITY_CATEGORY,
  normalizeEmail,
} from "../aggregates/identity.aggregate.js";
import { clockFor, type AuthDependencies } from "../dependencies.js";
import { findIdentityByEmail, markEmailVerified } from "../identity-resolution.js";
import { authEventMetadata } from "../utils/event-metadata.js";
import { loadIdentity } from "../utils/identity-store.js";
import { writePasswordHash } from "../utils/password-store.js";
import { revokeAllUserSessions } from "./revoke-all-user-sessions.command.js";
import { handleRevokeAllUserSessions } from "./revoke-all-user-sessions.handler.js";
import type { ResetPasswordCommand } from "./reset-password.command.js";

/**
 * Set a new password from a reset link.
 *
 * Every Session is revoked afterwards. A reset is what someone does when they
 * have lost control of their password, so the safe assumption is that someone
 * else may hold a Session — and leaving those alive would make the reset
 * cosmetic.
 *
 * Redeeming the link also verifies the address, since receiving mail at it is
 * the same proof the verification link asks for. Someone who registered but
 * never confirmed can therefore recover without being stuck.
 */
export async function handleResetPassword(
  deps: AuthDependencies,
  command: ResetPasswordCommand,
  context: RequestContext,
): Promise<void> {
  const at = clockFor(deps)();
  const { token, password } = command.payload;

  const consumed = await withTransaction(deps.pool, async (tx) => {
    const link = await consumeMagicLink(tx, { token, purpose: "reset_password", now: at });

    if (link === undefined) {
      await recordAuthAudit(tx, {
        eventType: "magic_link_rejected",
        outcome: "failure",
        reason: "invalid_expired_or_consumed",
        traceId: context.traceId,
      });
    }

    return link;
  });

  if (consumed === undefined) {
    throw new UnauthenticatedError("Invalid or expired reset link");
  }

  // Checked after the link is consumed rather than before: a rejected password
  // must not leave the link reusable, and a link that survives a failed attempt
  // is a link an attacker can keep trying.
  const policy = checkPassword(deps.config.passwordPolicy, password, consumed.email);

  if (!policy.ok) {
    throw new ValidationError(describeRejection(policy.reason, deps.config.passwordPolicy), {
      field: "password",
    });
  }

  const normalizedEmail = normalizeEmail(consumed.email);
  const identityId = await withTransaction(deps.pool, (tx) =>
    findIdentityByEmail(tx, normalizedEmail),
  );

  if (identityId === undefined) {
    throw new UnauthenticatedError("Invalid or expired reset link");
  }

  const passwordHash = await hashPassword(deps.config.passwordHashing, password);
  const { revision } = await loadIdentity(deps, identityId);

  await withTransaction(deps.pool, async (tx) => {
    await writePasswordHash(tx, identityId, passwordHash);
    await markEmailVerified(tx, normalizedEmail, at);

    await recordAuthAudit(tx, {
      eventType: "password_reset_completed",
      outcome: "success",
      identityId,
      traceId: context.traceId,
    });
  });

  const decision = decideSetPassword(
    { ...(await loadIdentity(deps, identityId)).state },
    { algorithm: "argon2id", reason: "reset", now: at },
  );

  if (decision.ok) {
    await appendEvents({
      client: deps.client,
      streamName: streamName(IDENTITY_CATEGORY, identityId),
      events: decision.events,
      metadata: authEventMetadata(context, identityId),
      expectedRevision: revision,
    });
  }

  await handleRevokeAllUserSessions(
    deps,
    revokeAllUserSessions(identityId, "password_reset"),
    context,
  );
}
