import { USERS_BOUNDARY } from "@chronologity/contracts";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import type { AuthConfig } from "../../config/auth-config.js";
import type { EmailClient } from "../../integrations/email/email-client.js";
import { recordAuthAudit } from "../../lib/auth/audit.js";
import { consumeMagicLink, issueMagicLink } from "../../lib/auth/magic-link.js";
import { enqueueOutboxMessage } from "../../lib/database/outbox.js";
import { withTransaction, type Transaction } from "../../lib/database/transaction.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { UnauthenticatedError } from "../../lib/errors/unauthorized-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import { generateId } from "../../lib/ids/generate-id.js";
import { topicName } from "../../lib/messaging/topics.js";
import type { RequestContext } from "../../types/request-context.js";
import {
  linkLifetimeMinutes,
  linkUrlFor,
  normalizeEmail,
} from "../authentication/authentication.policy.js";
import type { IdentityRepository } from "../authentication/identity.repository.js";
import type { PhoneRepository } from "../authentication/phone.repository.js";
import type { SessionRepository } from "../authentication/session.repository.js";
import { announceSecurityChange } from "../authentication/security-events.js";
import type { UserRepository } from "../users/user.repository.js";
import type { ErasureRepository } from "./erasure.repository.js";

/**
 * Deleting an account.
 *
 * Deactivation hides an account and can be undone; this cannot, and the
 * difference is why it takes two steps. A live session proves somebody signed
 * in once, which is what an unattended laptop also proves. Consuming a fresh
 * link proves they can read the mailbox now — the strengthening
 * `changePassword` gets from demanding the current password, available to every
 * account rather than only those that have one.
 *
 * The mail arriving is itself a control. Somebody who has taken an account over
 * cannot quietly delete it: the request reaches the real owner's inbox before
 * anything happens.
 *
 * What runs here is only the part that must be immediate — the account stops
 * working and its credentials go. Erasing what it recorded is unbounded work
 * and belongs to the worker, which is why this ends by writing down what is
 * still owed rather than by doing it.
 */
export class AccountDeletionService {
  /**
   * Build the account deletion service.
   *
   * @param dataSource - Opens the transaction the whole synchronous half
   *   commits in.
   * @param users - Where the account is tombstoned and its handle released.
   * @param identities - Where addresses and the password live.
   * @param sessions - Removed rather than revoked: a Session row carries a
   *   refresh-token hash.
   * @param phones - The second factor, which is also a phone number.
   * @param erasures - Where the work still owed is recorded.
   * @param email - Sends the confirmation link, and the notice afterwards.
   * @param config - Link lifetime and the base URL links point at.
   * @param clock - Injected so tests can move time without waiting.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UserRepository,
    private readonly identities: IdentityRepository,
    private readonly sessions: SessionRepository,
    private readonly phones: PhoneRepository,
    private readonly erasures: ErasureRepository,
    private readonly email: EmailClient,
    private readonly config: AuthConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Ask to delete an account, and send the link that confirms it.
   *
   * @param identityId - The signed-in Identity.
   * @param context - Trace identifier and receipt time.
   * @returns Nothing. Asking twice sends a second link and invalidates neither:
   *   letting a new request cancel a pending one would hand anybody who can
   *   reach this endpoint a way to stop somebody else's deletion.
   * @throws {ValidationError} If the account has no verified address. Nothing
   *   could prove control of it, and deleting on a session alone is exactly the
   *   weaker thing this step exists to avoid.
   */
  async request(identityId: string, context: RequestContext): Promise<void> {
    const at = this.clock();
    const address = await this.identities.findVerifiedEmailFor(identityId);

    if (address === undefined) {
      throw new ValidationError(
        "This account has no verified email address to confirm deletion with",
      );
    }

    const link = await withTransaction(this.dataSource, async (tx) => {
      await recordAuthAudit(tx, {
        eventType: "account_deletion_requested",
        outcome: "success",
        identityId,
        traceId: context.traceId,
      });

      return issueMagicLink(tx, {
        email: normalizeEmail(address),
        purpose: "confirm_deletion",
        ttlSeconds: this.config.magicLinkTtlSeconds,
        now: at,
      });
    });

    // Sent after the transaction commits, following every other link this
    // system issues: a link in somebody's inbox that no row backs is worse than
    // a row with no link, because only one of the two can be retried.
    await this.email.send({
      to: address,
      subject: "Confirm that you want to delete your Chronologity account",
      text: [
        "You asked to delete your Chronologity account.",
        "",
        "This cannot be undone. Your Moments, their photographs and videos, your comments, and your reactions will all be removed. If you only want to step away for a while, deactivate your account instead — that can be reversed.",
        "",
        `Confirm here: ${linkUrlFor(this.config.magicLinkBaseUrl, "confirm_deletion", link.token)}`,
        "",
        `The link stops working in ${linkLifetimeMinutes(this.config.magicLinkTtlSeconds)} minutes.`,
        "",
        "If you did not ask for this, somebody else may have access to your account. Change your password and sign out of every device.",
      ].join("\n"),
    });
  }

  /**
   * Confirm it, and stop the account working.
   *
   * Everything here commits together. A half-deleted account — credentials gone
   * but the profile still readable, or the reverse — is a state nothing would
   * recover from, because the person who could ask again can no longer sign in.
   *
   * @param userId - Whose account.
   * @param identityId - The signed-in Identity, which the link must belong to.
   * @param token - The raw token from the confirmation link.
   * @param context - Trace identifier and receipt time.
   * @returns Nothing.
   * @throws {UnauthenticatedError} If the link is unknown, expired, already
   *   used, of another purpose, or belongs to a different Identity. All five
   *   answer identically: distinguishing them tells somebody probing which of
   *   their guesses was closest.
   * @throws {NotFoundError} If there is no such account.
   */
  async confirm(
    userId: string,
    identityId: string,
    token: string,
    context: RequestContext,
  ): Promise<void> {
    const at = this.clock();
    // Read before anything is erased. Afterwards there is no address left to
    // tell them it happened.
    const address = await this.identities.findVerifiedEmailFor(identityId);

    await withTransaction(this.dataSource, async (tx) => {
      const consumed = await consumeMagicLink(tx, {
        token,
        purpose: "confirm_deletion",
        now: at,
      });

      if (consumed === undefined) {
        await recordAuthAudit(tx, {
          eventType: "magic_link_rejected",
          outcome: "failure",
          reason: "invalid_expired_or_consumed",
          identityId,
          traceId: context.traceId,
        });

        throw new UnauthenticatedError("Invalid or expired confirmation link");
      }

      // The link proves control of an address; this proves it is *this*
      // account's address. Without it, a link issued for one account would
      // delete whichever account happened to be signed in.
      const owner = await this.identities.findByEmail(normalizeEmail(consumed.email));

      if (owner !== identityId) {
        await recordAuthAudit(tx, {
          eventType: "magic_link_rejected",
          outcome: "failure",
          reason: "link_belongs_to_another_identity",
          identityId,
          traceId: context.traceId,
        });

        throw new UnauthenticatedError("Invalid or expired confirmation link");
      }

      const releasedHandle = await this.users.tombstone(tx, userId, at);

      if (releasedHandle === undefined) {
        throw new NotFoundError("No such account");
      }

      if (releasedHandle !== "") {
        // Released rather than deleted, so the existing cooldown applies. That
        // cooldown is what stops an onlooker taking a departed account's name
        // the moment it frees.
        await this.users.releaseHandle(tx, releasedHandle, at);
      }

      await this.identities.eraseCredentials(tx, identityId);
      await this.phones.remove(tx, identityId);
      await this.sessions.eraseAllForIdentity(tx, identityId);

      await recordAuthAudit(tx, {
        eventType: "account_deleted",
        outcome: "success",
        identityId,
        traceId: context.traceId,
      });

      await announceSecurityChange(tx, this.users, {
        identityId,
        change: "sessions_revoked",
        at,
        traceId: context.traceId,
      });

      await this.announce(tx, userId, at, context);

      // The last thing, and the reason the rest is safe to do now: what remains
      // is unbounded and belongs to the worker.
      await this.erasures.request(tx, {
        requestId: generateId(),
        subjectType: "account",
        subjectId: userId,
        at,
      });
    });

    if (address !== undefined) {
      // After the commit, to an address that no longer exists in this system.
      // Somebody whose account was deleted without their knowing needs to be
      // told, and this is the last moment it is possible to tell them.
      await this.email.send({
        to: address,
        subject: "Your Chronologity account has been deleted",
        text: [
          "Your Chronologity account has been deleted and can no longer be signed in to.",
          "",
          "Your Moments, their photographs and videos, your comments, and your reactions are being removed. This cannot be undone.",
          "",
          "If you did not do this, contact us — but be aware that the account itself is gone.",
        ].join("\n"),
      });
    }
  }

  /**
   * Tell the rest of the system the account has gone.
   *
   * @param tx - The caller's transaction.
   * @param userId - Whose account.
   * @param at - When.
   * @param context - The request that caused it.
   * @returns Nothing. The event says the status changed and nothing more; what
   *   the account was is not something to put on a topic that cannot be erased.
   */
  private async announce(
    tx: Transaction,
    userId: string,
    at: Date,
    context: RequestContext,
  ): Promise<void> {
    const traceId = context.traceId ?? randomUUID();

    await enqueueOutboxMessage(tx, {
      topic: topicName(USERS_BOUNDARY),
      partitionKey: userId,
      aggregateType: "user",
      aggregateId: userId,
      aggregateVersion: 0,
      eventType: "UserStatusChanged",
      eventVersion: 1,
      payload: { userId, status: "deleted", changedAt: at.toISOString() },
      metadata: {
        traceId,
        correlationId: traceId,
        causationId: undefined,
        actorUserId: userId,
        eventVersion: 1,
        recordedAt: at.toISOString(),
      },
    });
  }
}
