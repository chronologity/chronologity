import { recordAuthAudit } from "../../../lib/auth/audit.js";
import { issueMagicLink } from "../../../lib/auth/magic-link.js";
import { withTransaction } from "../../../lib/database/transaction.js";
import type { RequestContext } from "../../../types/request-context.js";
import { normalizeEmail } from "../aggregates/identity.aggregate.js";
import { clockFor, type AuthDependencies } from "../dependencies.js";
import { findIdentityByEmail } from "../identity-resolution.js";
import type { RequestPasswordResetCommand } from "./request-password-reset.command.js";

/**
 * Send a password reset link, if there is an account to send it for.
 *
 * Reports nothing either way. Unlike sign-in links — which are harmless to
 * issue for an address that has no account, because redeeming one simply
 * creates the account — a reset link is only meaningful for an existing
 * Identity, so no link is issued when there is none. The response does not
 * change, which is what keeps that difference invisible.
 */
export async function handleRequestPasswordReset(
  deps: AuthDependencies,
  command: RequestPasswordResetCommand,
  context: RequestContext,
): Promise<void> {
  const at = clockFor(deps)();
  const { email } = command.payload;

  const identityId = await withTransaction(deps.pool, (tx) => findIdentityByEmail(tx, email));

  if (identityId === undefined) {
    return;
  }

  const link = await withTransaction(deps.pool, async (tx) => {
    const issued = await issueMagicLink(tx, {
      email: normalizeEmail(email),
      purpose: "reset_password",
      ttlSeconds: deps.config.magicLinkTtlSeconds,
      now: at,
    });

    await recordAuthAudit(tx, {
      eventType: "password_reset_requested",
      outcome: "success",
      identityId,
      traceId: context.traceId,
    });

    return issued;
  });

  await deps.email.send({
    to: email,
    subject: "Reset your Chronologity password",
    text: [
      "Use this link to choose a new password:",
      "",
      `${deps.config.magicLinkBaseUrl.replace("/sessions", "/password-resets/complete")}?token=${link.token}`,
      "",
      `This link works once and expires in ${Math.round(deps.config.magicLinkTtlSeconds / 60)} minutes.`,
      "Resetting your password signs you out everywhere.",
      "",
      "If you did not ask for this, you can ignore this message; your password",
      "has not changed.",
    ].join("\n"),
  });
}
