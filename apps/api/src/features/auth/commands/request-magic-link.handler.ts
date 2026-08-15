import { recordAuthAudit } from "../../../lib/auth/audit.js";
import { issueMagicLink } from "../../../lib/auth/magic-link.js";
import { withTransaction } from "../../../lib/database/transaction.js";
import type { RequestContext } from "../../../types/request-context.js";
import { clockFor, type AuthDependencies } from "../dependencies.js";
import type { RequestMagicLinkCommand } from "./request-magic-link.command.js";

/**
 * Issue a sign-in link and send it.
 *
 * Returns nothing regardless of whether the address is known. Whether a link
 * was sent is recorded in the audit trail, where it is useful, rather than
 * surfaced to the caller, where it would enumerate accounts.
 *
 * Existing unconsumed links for the address are left alone: invalidating them
 * would let anyone cancel someone else's pending sign-in by requesting a new
 * one.
 */
export async function handleRequestMagicLink(
  deps: AuthDependencies,
  command: RequestMagicLinkCommand,
  context: RequestContext,
): Promise<void> {
  const at = clockFor(deps)();

  const link = await withTransaction(deps.pool, async (tx) => {
    const issued = await issueMagicLink(tx, {
      email: command.payload.email,
      purpose: "login",
      ttlSeconds: deps.config.magicLinkTtlSeconds,
      now: at,
    });

    await recordAuthAudit(tx, {
      eventType: "magic_link_requested",
      outcome: "success",
      traceId: context.traceId,
    });

    return issued;
  });

  // Sent outside the transaction: holding a database transaction open across an
  // SMTP conversation ties a connection to a remote server's latency.
  await deps.email.send({
    to: command.payload.email,
    subject: "Your Chronologity sign-in link",
    text: [
      "Use this link to sign in to Chronologity:",
      "",
      `${deps.config.magicLinkBaseUrl}?token=${link.token}`,
      "",
      `This link works once and expires in ${Math.round(deps.config.magicLinkTtlSeconds / 60)} minutes.`,
      "If you did not request it, you can ignore this message.",
    ].join("\n"),
  });
}
