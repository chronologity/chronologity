import { recordAuthAudit } from "../../../lib/auth/audit.js";
import { issueMagicLink } from "../../../lib/auth/magic-link.js";
import { hashPassword } from "../../../lib/auth/password.js";
import { checkPassword, describeRejection } from "../../../lib/auth/password-policy.js";
import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents, ConcurrencyConflictError } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import { ValidationError } from "../../../lib/errors/validation-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import {
  decideCreateIdentity,
  decideSetPassword,
  IDENTITY_CATEGORY,
  initialIdentityState,
  normalizeEmail,
} from "../aggregates/identity.aggregate.js";
import { clockFor, type AuthDependencies } from "../dependencies.js";
import { findIdentityByEmail, resolveIdentityForEmail } from "../identity-resolution.js";
import { authEventMetadata } from "../utils/event-metadata.js";
import { writePasswordHash } from "../utils/password-store.js";
import type { RegisterIdentityCommand } from "./register-identity.command.js";

/**
 * Register an address with a password.
 *
 * The address is *not* verified by registering — anyone can type any address —
 * so the Identity is created with it unverified and a verification link is
 * sent. Password sign-in stays refused until that link is redeemed
 * (`authentication.md:240`).
 *
 * Registering an address that already exists produces exactly the same
 * response as registering a new one, and sends the existing owner a notice
 * instead. Telling the caller "that address is taken" is a free account
 * oracle, and it is worth noticing that the person who most needs to know
 * someone tried is the owner, not the person trying.
 *
 * The password policy is checked before anything is written, and its failure
 * is the one thing here that *is* reported plainly: refusing a password
 * without saying why leaves someone guessing at rules they cannot see.
 */
export async function handleRegisterIdentity(
  deps: AuthDependencies,
  command: RegisterIdentityCommand,
  context: RequestContext,
): Promise<void> {
  const at = clockFor(deps)();
  const { email, password } = command.payload;

  const policy = checkPassword(deps.config.passwordPolicy, password, email);

  if (!policy.ok) {
    throw new ValidationError(describeRejection(policy.reason, deps.config.passwordPolicy), {
      field: "password",
    });
  }

  const existing = await withTransaction(deps.pool, (tx) => findIdentityByEmail(tx, email));

  if (existing !== undefined) {
    await withTransaction(deps.pool, (tx) =>
      recordAuthAudit(tx, {
        eventType: "magic_link_requested",
        outcome: "success",
        identityId: existing,
        reason: "registration_attempt_on_existing_address",
        traceId: context.traceId,
      }),
    );

    // The owner hears about it; the caller learns nothing.
    await deps.email.send({
      to: email,
      subject: "Someone tried to register with your address",
      text: [
        "Someone tried to create a Chronologity account with this address.",
        "",
        "You already have an account, so nothing has changed. If this was you,",
        "sign in instead, or reset your password if you have forgotten it.",
        "",
        "If it was not you, no action is needed.",
      ].join("\n"),
    });

    return;
  }

  // Hashed before the transaction: Argon2id is deliberately slow, and holding
  // a database connection open for the duration would tie up the pool under
  // exactly the load this endpoint attracts.
  const passwordHash = await hashPassword(deps.config.passwordHashing, password);

  const identity = await withTransaction(deps.pool, async (tx) => {
    const resolved = await resolveIdentityForEmail(tx, { email, now: at, verified: false });

    await writePasswordHash(tx, resolved.identityId, passwordHash);

    await recordAuthAudit(tx, {
      eventType: "identity_registered",
      outcome: "success",
      identityId: resolved.identityId,
      traceId: context.traceId,
    });

    return resolved;
  });

  if (identity.created) {
    const creation = decideCreateIdentity(initialIdentityState, {
      identityId: identity.identityId,
      email,
      emailVerified: false,
      now: at,
    });

    const passwordEvent = decideSetPassword(
      { ...initialIdentityState, exists: true },
      { algorithm: "argon2id", reason: "registration", now: at },
    );

    if (creation.ok && passwordEvent.ok) {
      try {
        await appendEvents({
          client: deps.client,
          streamName: streamName(IDENTITY_CATEGORY, identity.identityId),
          events: [...creation.events, ...passwordEvent.events],
          metadata: authEventMetadata(context, identity.identityId),
          expectedRevision: "no_stream",
        });
      } catch (error) {
        if (!(error instanceof ConcurrencyConflictError)) {
          throw error;
        }

        deps.logger?.debug({ identityId: identity.identityId }, "Identity history already written");
      }
    }
  }

  const link = await withTransaction(deps.pool, (tx) =>
    issueMagicLink(tx, {
      email: normalizeEmail(email),
      purpose: "verify_email",
      ttlSeconds: deps.config.magicLinkTtlSeconds,
      now: at,
    }),
  );

  await deps.email.send({
    to: email,
    subject: "Confirm your Chronologity address",
    text: [
      "Confirm this address to finish setting up your Chronologity account:",
      "",
      `${deps.config.magicLinkBaseUrl.replace("/sessions", "/email-verifications")}?token=${link.token}`,
      "",
      `This link works once and expires in ${Math.round(deps.config.magicLinkTtlSeconds / 60)} minutes.`,
      "If you did not create an account, you can ignore this message.",
    ].join("\n"),
  });
}
