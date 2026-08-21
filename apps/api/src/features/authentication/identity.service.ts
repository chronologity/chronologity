import type { SessionCredentials } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { recordAuthAudit } from "../../lib/auth/audit.js";
import { consumeMagicLink, issueMagicLink } from "../../lib/auth/magic-link.js";
import {
  hashPassword,
  needsRehash,
  verifyDummyPassword,
  verifyPassword,
} from "../../lib/auth/password.js";
import { checkPassword, describeRejection } from "../../lib/auth/password-policy.js";
import type { AuthConfig } from "../../config/auth-config.js";
import type { EmailClient } from "../../integrations/email/email-client.js";
import { withTransaction } from "../../lib/database/transaction.js";
import { UnauthenticatedError } from "../../lib/errors/unauthorized-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import type { RequestContext } from "../../types/request-context.js";
import { linkLifetimeMinutes, linkUrlFor, normalizeEmail } from "./authentication.policy.js";
import type { IdentityRepository } from "./identity.repository.js";
import type { SessionService } from "./session.service.js";

/**
 * Identities: proving who someone is.
 *
 * An Identity owns how a person authenticates — verified addresses and, later,
 * linked providers. It owns nothing a person chooses about themselves; the
 * profile, the handle, and the display name belong to User.
 *
 * Two rules shape almost everything here. Nothing tells a caller whether an
 * address exists: the differences between "no such account", "wrong password",
 * "unverified address", and "wrong link" are precisely what someone probing for
 * accounts wants to learn, so they are one refusal. And proving control of an
 * address is separate from being signed in, so redeeming a verification link
 * grants no Session.
 *
 * Establishing a Session is delegated rather than duplicated. A magic link and
 * a password are different proofs of the same thing, and what follows the proof
 * must be identical.
 */
export class IdentityService {
  /**
   * Build the Identity service.
   *
   * @param dataSource - Opens the transactions this service's writes commit in.
   * @param identities - Where identities, addresses, and credentials are stored.
   * @param sessions - Grants Sessions once a proof has been accepted, and ends
   *   them when a password changes.
   * @param email - Sends links. Read back from Mailpit in tests, so delivery is
   *   never stubbed.
   * @param config - Link lifetimes, hashing cost, and password policy.
   * @param clock - Injected so tests can move time without waiting.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly identities: IdentityRepository,
    private readonly sessions: SessionService,
    private readonly email: EmailClient,
    private readonly config: AuthConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {}

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
   *
   * @param email - The address to send to, as typed.
   * @param context - Trace identifier and receipt time.
   * @returns Nothing, whether or not the address is known.
   */
  async requestLink(email: string, context: RequestContext): Promise<void> {
    const at = this.clock();

    const link = await withTransaction(this.dataSource, async (tx) => {
      const issued = await issueMagicLink(tx, {
        email,
        purpose: "login",
        ttlSeconds: this.config.magicLinkTtlSeconds,
        now: at,
      });

      await recordAuthAudit(tx, {
        eventType: "magic_link_requested",
        outcome: "success",
        traceId: context.traceId,
      });

      return issued;
    });

    // Sent outside the transaction: holding a database transaction open across
    // an SMTP conversation ties a connection to a remote server's latency.
    await this.email.send({
      to: email,
      subject: "Your Chronologity sign-in link",
      text: [
        "Use this link to sign in to Chronologity:",
        "",
        linkUrlFor(this.config.magicLinkBaseUrl, "login", link.token),
        "",
        `This link works once and expires in ${linkLifetimeMinutes(this.config.magicLinkTtlSeconds)} minutes.`,
        "If you did not request it, you can ignore this message.",
      ].join("\n"),
    });
  }

  /**
   * Redeem a sign-in link and establish a Session.
   *
   * Redeeming the link is itself proof of control of the address, so a
   * first-time address creates an Identity with that address already verified
   * rather than asking someone to confirm what they have just demonstrated.
   *
   * @param token - The raw token from the emailed link.
   * @param clientKind - A short description of the client, when it sent one.
   * @param context - Trace identifier and receipt time.
   * @returns The new Session's credentials.
   * @throws {UnauthenticatedError} If the link is expired, already used, of the
   *   wrong purpose, or was never issued. All four are one refusal, because the
   *   differences are what an attacker is probing for.
   */
  async signInWithLink(
    token: string,
    clientKind: string | undefined,
    context: RequestContext,
  ): Promise<SessionCredentials> {
    const at = this.clock();

    const identityId = await withTransaction(this.dataSource, async (tx) => {
      const consumed = await consumeMagicLink(tx, { token, purpose: "login", now: at });

      if (consumed === undefined) {
        await recordAuthAudit(tx, {
          eventType: "magic_link_rejected",
          outcome: "failure",
          reason: "invalid_expired_or_consumed",
          traceId: context.traceId,
        });

        return undefined;
      }

      const identity = await this.identities.resolveForEmail(tx, {
        email: consumed.email,
        now: at,
      });

      await recordAuthAudit(tx, {
        eventType: "magic_link_consumed",
        outcome: "success",
        identityId: identity.identityId,
        traceId: context.traceId,
      });

      return identity.identityId;
    });

    if (identityId === undefined) {
      throw new UnauthenticatedError("Invalid or expired sign-in link");
    }

    return this.sessions.issue({ identityId, clientKind, method: "magic_link", context });
  }

  /**
   * Register an address with a password.
   *
   * The address is *not* verified by registering — anyone can type any address
   * — so the Identity is created with it unverified and a verification link is
   * sent. Password sign-in stays refused until that link is redeemed
   * (`authentication.md:240`).
   *
   * Registering an address that already exists produces exactly the same
   * response as registering a new one, and sends the existing owner a notice
   * instead. Telling the caller "that address is taken" is a free account
   * oracle, and the person who most needs to know someone tried is the owner,
   * not the person trying.
   *
   * @param email - The address as typed, unproven until a link is redeemed.
   * @param password - The proposed plaintext.
   * @param context - Trace identifier and receipt time.
   * @returns Nothing. An address that is already registered produces the same
   *   result and notifies its owner instead of the caller.
   * @throws {ValidationError} If the password fails policy. The one thing here
   *   reported plainly: refusing without a reason leaves someone guessing at
   *   rules they cannot see.
   */
  async register(email: string, password: string, context: RequestContext): Promise<void> {
    const at = this.clock();
    const policy = checkPassword(this.config.passwordPolicy, password, email);

    if (!policy.ok) {
      throw new ValidationError(describeRejection(policy.reason, this.config.passwordPolicy), {
        field: "password",
      });
    }

    const existing = await this.identities.findByEmail(email);

    if (existing !== undefined) {
      await withTransaction(this.dataSource, (tx) =>
        recordAuthAudit(tx, {
          eventType: "magic_link_requested",
          outcome: "success",
          identityId: existing,
          reason: "registration_attempt_on_existing_address",
          traceId: context.traceId,
        }),
      );

      // The owner hears about it; the caller learns nothing.
      await this.email.send({
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
    const passwordHash = await hashPassword(this.config.passwordHashing, password);

    const link = await withTransaction(this.dataSource, async (tx) => {
      const identity = await this.identities.resolveForEmail(tx, {
        email,
        now: at,
        verified: false,
      });

      await this.identities.writePasswordHash(tx, identity.identityId, passwordHash);

      await recordAuthAudit(tx, {
        eventType: "identity_registered",
        outcome: "success",
        identityId: identity.identityId,
        traceId: context.traceId,
      });

      // Issued in the same transaction as the Identity it belongs to, so a
      // registration never commits without the link that completes it.
      return issueMagicLink(tx, {
        email: normalizeEmail(email),
        purpose: "verify_email",
        ttlSeconds: this.config.magicLinkTtlSeconds,
        now: at,
      });
    });

    await this.email.send({
      to: email,
      subject: "Confirm your Chronologity address",
      text: [
        "Confirm this address to finish setting up your Chronologity account:",
        "",
        linkUrlFor(this.config.magicLinkBaseUrl, "verify_email", link.token),
        "",
        `This link works once and expires in ${linkLifetimeMinutes(this.config.magicLinkTtlSeconds)} minutes.`,
        "If you did not create an account, you can ignore this message.",
      ].join("\n"),
    });
  }

  /**
   * Redeem a verification link.
   *
   * The link's purpose is bound into the token, so a sign-in link cannot be
   * used here and this one cannot be used to sign in. Verifying grants no
   * Session: proving an address and being signed in are separate things, and
   * conflating them would mean a forwarded verification email signs in whoever
   * opens it.
   *
   * @param token - The raw token from the verification link.
   * @param context - Trace identifier and receipt time.
   * @returns Nothing.
   * @throws {UnauthenticatedError} If the link is expired, already used, of the
   *   wrong purpose, or was never issued.
   */
  async verifyEmail(token: string, context: RequestContext): Promise<void> {
    const at = this.clock();

    const identityId = await withTransaction(this.dataSource, async (tx) => {
      const consumed = await consumeMagicLink(tx, { token, purpose: "verify_email", now: at });

      if (consumed === undefined) {
        await recordAuthAudit(tx, {
          eventType: "magic_link_rejected",
          outcome: "failure",
          reason: "invalid_expired_or_consumed",
          traceId: context.traceId,
        });

        return undefined;
      }

      const verified = await this.identities.markEmailVerified(
        tx,
        normalizeEmail(consumed.email),
        at,
      );

      if (verified === undefined) {
        return undefined;
      }

      await recordAuthAudit(tx, {
        eventType: "email_verified",
        outcome: "success",
        identityId: verified,
        traceId: context.traceId,
      });

      return verified;
    });

    if (identityId === undefined) {
      throw new UnauthenticatedError("Invalid or expired verification link");
    }
  }

  /**
   * Sign in with a password.
   *
   * Four things can go wrong — unknown address, no password set, unverified
   * address, wrong password — and all four produce one refusal.
   *
   * Timing is part of that. An unknown address still performs a full Argon2id
   * verification against a dummy hash, because returning early is measurable
   * and turns this endpoint into an account-existence oracle.
   *
   * @param email - The address as typed.
   * @param password - The submitted plaintext.
   * @param clientKind - A short description of the client, when it sent one.
   * @param context - Trace identifier and receipt time.
   * @returns The new Session's credentials.
   * @throws {UnauthenticatedError} If the address is unknown, has no password,
   *   is unverified, or the password is wrong. The unknown-address path still
   *   spends the time a real verification would.
   */
  async signInWithPassword(
    email: string,
    password: string,
    clientKind: string | undefined,
    context: RequestContext,
  ): Promise<SessionCredentials> {
    const normalizedEmail = normalizeEmail(email);
    const identityId = await this.identities.findByEmail(email);
    const storedHash =
      identityId === undefined ? undefined : await this.identities.findPasswordHash(identityId);

    if (identityId === undefined || storedHash === undefined) {
      // Spend the same time as a real verification before refusing.
      await verifyDummyPassword(this.config.passwordHashing, password);
      await this.recordRejection(context, identityId, "unknown_address_or_no_password");
      throw new UnauthenticatedError("Invalid email or password");
    }

    if (!(await verifyPassword(storedHash, password))) {
      await this.recordRejection(context, identityId, "incorrect_password");
      throw new UnauthenticatedError("Invalid email or password");
    }

    // Checked after the password, deliberately: an unverified address is only
    // interesting to someone who already knows the password, and checking first
    // would reveal that an address exists to anyone who guessed it.
    if (!(await this.identities.isEmailVerified(normalizedEmail))) {
      await this.recordRejection(context, identityId, "email_not_verified");
      throw new UnauthenticatedError("Invalid email or password");
    }

    // Cost parameters may have been raised since this hash was made. Now is the
    // only moment the plaintext is available to rehash with, so take it.
    if (needsRehash(this.config.passwordHashing, storedHash)) {
      const upgraded = await hashPassword(this.config.passwordHashing, password);

      await withTransaction(this.dataSource, async (tx) => {
        await this.identities.writePasswordHash(tx, identityId, upgraded);
        await recordAuthAudit(tx, {
          eventType: "password_set",
          outcome: "success",
          identityId,
          reason: "rehash_on_login",
          traceId: context.traceId,
        });
      });
    }

    return this.sessions.issue({ identityId, clientKind, method: "password", context });
  }

  /**
   * Send a password reset link, if there is an account to send it for.
   *
   * Reports nothing either way. Unlike a sign-in link — harmless to issue for
   * an address with no account, because redeeming one simply creates the
   * account — a reset link is only meaningful for an existing Identity, so none
   * is issued when there is none. The response does not change, which is what
   * keeps that difference invisible.
   *
   * @param email - The address to send to.
   * @param context - Trace identifier and receipt time.
   * @returns Nothing, whether or not an account exists.
   */
  async requestPasswordReset(email: string, context: RequestContext): Promise<void> {
    const at = this.clock();
    const identityId = await this.identities.findByEmail(email);

    if (identityId === undefined) {
      return;
    }

    const link = await withTransaction(this.dataSource, async (tx) => {
      const issued = await issueMagicLink(tx, {
        email: normalizeEmail(email),
        purpose: "reset_password",
        ttlSeconds: this.config.magicLinkTtlSeconds,
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

    await this.email.send({
      to: email,
      subject: "Reset your Chronologity password",
      text: [
        "Use this link to choose a new password:",
        "",
        linkUrlFor(this.config.magicLinkBaseUrl, "reset_password", link.token),
        "",
        `This link works once and expires in ${linkLifetimeMinutes(this.config.magicLinkTtlSeconds)} minutes.`,
        "Resetting your password signs you out everywhere.",
        "",
        "If you did not ask for this, you can ignore this message; your password",
        "has not changed.",
      ].join("\n"),
    });
  }

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
   *
   * @param token - The raw token from the reset link.
   * @param password - The proposed new plaintext.
   * @param context - Trace identifier and receipt time.
   * @returns Nothing.
   * @throws {UnauthenticatedError} If the link cannot be used.
   * @throws {ValidationError} If the new password fails policy. Checked after
   *   the link is consumed, so a rejected password does not leave the link
   *   reusable for someone to keep trying against.
   */
  async resetPassword(token: string, password: string, context: RequestContext): Promise<void> {
    const at = this.clock();

    const consumed = await withTransaction(this.dataSource, async (tx) => {
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

    const policy = checkPassword(this.config.passwordPolicy, password, consumed.email);

    if (!policy.ok) {
      throw new ValidationError(describeRejection(policy.reason, this.config.passwordPolicy), {
        field: "password",
      });
    }

    const normalizedEmail = normalizeEmail(consumed.email);
    const identityId = await this.identities.findByEmail(normalizedEmail);

    if (identityId === undefined) {
      throw new UnauthenticatedError("Invalid or expired reset link");
    }

    const passwordHash = await hashPassword(this.config.passwordHashing, password);

    await withTransaction(this.dataSource, async (tx) => {
      await this.identities.writePasswordHash(tx, identityId, passwordHash);
      await this.identities.markEmailVerified(tx, normalizedEmail, at);

      await recordAuthAudit(tx, {
        eventType: "password_reset_completed",
        outcome: "success",
        identityId,
        traceId: context.traceId,
      });
    });

    await this.sessions.revokeAll({ identityId, reason: "password_reset", context });
  }

  /**
   * Change a password while signed in.
   *
   * The current password is required despite the caller already holding a valid
   * Session. An access token left behind on a shared or stolen device should not
   * be enough to take an account over, and this is the step that makes it not
   * enough.
   *
   * Every other Session is revoked and the current one is kept. Changing a
   * password is a deliberate act by someone present, so logging them out of the
   * device they are using would punish good hygiene — but any other Session may
   * belong to whoever prompted the change.
   *
   * @param input - Who is changing it, from which Session, and both passwords.
   * @param context - Trace identifier and receipt time.
   * @returns How many other Sessions were revoked.
   * @throws {UnauthenticatedError} If the current password is wrong.
   * @throws {ValidationError} If the new password fails policy.
   */
  async changePassword(
    input: {
      identityId: string;
      currentSessionId: string;
      currentPassword: string;
      newPassword: string;
    },
    context: RequestContext,
  ): Promise<number> {
    const { identityId, currentSessionId, currentPassword, newPassword } = input;
    const storedHash = await this.identities.findPasswordHash(identityId);

    if (storedHash === undefined || !(await verifyPassword(storedHash, currentPassword))) {
      await withTransaction(this.dataSource, (tx) =>
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

    const policy = checkPassword(this.config.passwordPolicy, newPassword);

    if (!policy.ok) {
      throw new ValidationError(describeRejection(policy.reason, this.config.passwordPolicy), {
        field: "newPassword",
      });
    }

    const passwordHash = await hashPassword(this.config.passwordHashing, newPassword);

    await withTransaction(this.dataSource, async (tx) => {
      await this.identities.writePasswordHash(tx, identityId, passwordHash);
      await recordAuthAudit(tx, {
        eventType: "password_changed",
        outcome: "success",
        identityId,
        sessionId: currentSessionId,
        traceId: context.traceId,
      });
    });

    return this.sessions.revokeAll({
      identityId,
      reason: "password_changed",
      exceptSessionId: currentSessionId,
      context,
    });
  }

  /**
   * Record a refused sign-in.
   *
   * @param context - Trace identifier.
   * @param identityId - Whose attempt, when known.
   * @param reason - Why it was refused. Recorded for investigation; never
   *   returned, since the differences between the reasons are what an attacker
   *   is probing for.
   * @returns Nothing.
   */
  private async recordRejection(
    context: RequestContext,
    identityId: string | undefined,
    reason: string,
  ): Promise<void> {
    await withTransaction(this.dataSource, (tx) =>
      recordAuthAudit(tx, {
        eventType: "password_sign_in_rejected",
        outcome: "failure",
        identityId,
        reason,
        traceId: context.traceId,
      }),
    );
  }
}
