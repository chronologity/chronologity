import type { SessionCredentials } from "@chronologity/contracts";
import { recordAuthAudit } from "../../../lib/auth/audit.js";
import {
  hashPassword,
  needsRehash,
  verifyDummyPassword,
  verifyPassword,
} from "../../../lib/auth/password.js";
import { withTransaction } from "../../../lib/database/transaction.js";
import { UnauthenticatedError } from "../../../lib/errors/unauthorized-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import { normalizeEmail } from "../aggregates/identity.aggregate.js";
import { clockFor, type AuthDependencies } from "../dependencies.js";
import { findIdentityByEmail, isEmailVerified } from "../identity-resolution.js";
import { issueSessionFor } from "../utils/issue-session.js";
import { readPasswordHash, writePasswordHash } from "../utils/password-store.js";
import type { AuthenticateWithPasswordCommand } from "./authenticate-with-password.command.js";

/**
 * Sign in with a password.
 *
 * Four things can go wrong — unknown address, no password set, unverified
 * address, wrong password — and all four produce one refusal. The differences
 * are precisely what someone probing for accounts wants to learn.
 *
 * Timing is part of that. An unknown address still performs a full Argon2id
 * verification against a dummy hash, because returning early is measurable and
 * turns this endpoint into an account-existence oracle.
 */
export async function handleAuthenticateWithPassword(
  deps: AuthDependencies,
  command: AuthenticateWithPasswordCommand,
  context: RequestContext,
): Promise<SessionCredentials> {
  const at = clockFor(deps)();
  const { email, password, clientKind } = command.payload;
  const normalizedEmail = normalizeEmail(email);

  const identityId = await withTransaction(deps.pool, (tx) => findIdentityByEmail(tx, email));
  const storedHash =
    identityId === undefined ? undefined : await readPasswordHash(deps.pool, identityId);

  if (storedHash === undefined) {
    // Spend the same time as a real verification before refusing.
    await verifyDummyPassword(deps.config.passwordHashing, password);
    await recordRejection(deps, context, identityId, "unknown_address_or_no_password");
    throw new UnauthenticatedError("Invalid email or password");
  }

  const correct = await verifyPassword(storedHash, password);

  if (!correct) {
    await recordRejection(deps, context, identityId, "incorrect_password");
    throw new UnauthenticatedError("Invalid email or password");
  }

  // Checked after the password, deliberately: an unverified address is only
  // interesting to someone who already knows the password, and checking first
  // would reveal that an address exists to anyone who guessed it.
  const verified = await withTransaction(deps.pool, (tx) => isEmailVerified(tx, normalizedEmail));

  if (!verified) {
    await recordRejection(deps, context, identityId, "email_not_verified");
    throw new UnauthenticatedError("Invalid email or password");
  }

  // Cost parameters may have been raised since this hash was made. Now is the
  // only moment the plaintext is available to rehash with, so take it.
  if (needsRehash(deps.config.passwordHashing, storedHash)) {
    const upgraded = await hashPassword(deps.config.passwordHashing, password);

    await withTransaction(deps.pool, async (tx) => {
      await writePasswordHash(tx, identityId as string, upgraded);
      await recordAuthAudit(tx, {
        eventType: "password_set",
        outcome: "success",
        identityId,
        reason: "rehash_on_login",
        traceId: context.traceId,
      });
    });
  }

  return issueSessionFor(deps, {
    identityId: identityId as string,
    clientKind,
    method: "password",
    context,
    at,
  });
}

async function recordRejection(
  deps: AuthDependencies,
  context: RequestContext,
  identityId: string | undefined,
  reason: string,
): Promise<void> {
  await withTransaction(deps.pool, (tx) =>
    recordAuthAudit(tx, {
      eventType: "password_sign_in_rejected",
      outcome: "failure",
      identityId,
      reason,
      traceId: context.traceId,
    }),
  );
}
