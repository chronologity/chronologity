import { recordAuthAudit } from "../../../lib/auth/audit.js";
import { hashPassword, verifyPassword } from "../../../lib/auth/password.js";
import { checkPassword, describeRejection } from "../../../lib/auth/password-policy.js";
import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import { UnauthenticatedError } from "../../../lib/errors/unauthorized-error.js";
import { ValidationError } from "../../../lib/errors/validation-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import { decideSetPassword, IDENTITY_CATEGORY } from "../aggregates/identity.aggregate.js";
import { clockFor, type AuthDependencies } from "../dependencies.js";
import { authEventMetadata } from "../utils/event-metadata.js";
import { loadIdentity } from "../utils/identity-store.js";
import { readPasswordHash, writePasswordHash } from "../utils/password-store.js";
import { revokeSession } from "./revoke-session.command.js";
import { handleRevokeSession } from "./revoke-session.handler.js";
import type { ChangePasswordCommand } from "./change-password.command.js";

/**
 * Change a password while signed in.
 *
 * The current password is required despite the caller already holding a valid
 * Session. An access token left behind on a shared or stolen device should not
 * be enough to take an account over, and this is the step that makes it not
 * enough.
 *
 * Every other Session is revoked, and the current one is kept. Changing a
 * password is a deliberate act by someone present, so logging them out of the
 * device they are using would be a punishment for good hygiene — but any other
 * session may belong to whoever prompted the change.
 */
export async function handleChangePassword(
  deps: AuthDependencies,
  command: ChangePasswordCommand,
  context: RequestContext,
): Promise<number> {
  const at = clockFor(deps)();
  const { identityId, currentSessionId, currentPassword, newPassword } = command.payload;

  const storedHash = await readPasswordHash(deps.pool, identityId);

  if (storedHash === undefined || !(await verifyPassword(storedHash, currentPassword))) {
    await withTransaction(deps.pool, (tx) =>
      recordAuthAudit(tx, {
        eventType: "password_sign_in_rejected",
        outcome: "failure",
        identityId,
        sessionId: currentSessionId,
        reason: "incorrect_current_password",
        traceId: context.traceId,
      }),
    );

    throw new UnauthenticatedError("Current password is incorrect");
  }

  const policy = checkPassword(deps.config.passwordPolicy, newPassword);

  if (!policy.ok) {
    throw new ValidationError(describeRejection(policy.reason, deps.config.passwordPolicy), {
      field: "newPassword",
    });
  }

  const passwordHash = await hashPassword(deps.config.passwordHashing, newPassword);
  const { state, revision } = await loadIdentity(deps, identityId);

  await withTransaction(deps.pool, async (tx) => {
    await writePasswordHash(tx, identityId, passwordHash);
    await recordAuthAudit(tx, {
      eventType: "password_changed",
      outcome: "success",
      identityId,
      sessionId: currentSessionId,
      traceId: context.traceId,
    });
  });

  const decision = decideSetPassword(state, {
    algorithm: "argon2id",
    reason: "change",
    now: at,
  });

  if (decision.ok) {
    await appendEvents({
      client: deps.client,
      streamName: streamName(IDENTITY_CATEGORY, identityId),
      events: decision.events,
      metadata: authEventMetadata(context, identityId),
      expectedRevision: revision,
    });
  }

  const { rows } = await deps.pool.query<{ session_id: string }>(
    `SELECT session_id FROM sessions
      WHERE identity_id = $1 AND revoked_at IS NULL AND session_id <> $2`,
    [identityId, currentSessionId],
  );

  for (const row of rows) {
    await handleRevokeSession(
      deps,
      revokeSession(row.session_id, identityId, "password_changed"),
      context,
    );
  }

  return rows.length;
}
