import type { SessionCredentials } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import type { AuthConfig } from "../../config/auth-config.js";
import type { EmailClient } from "../../integrations/email/email-client.js";
import type { SmsClient } from "../../integrations/sms/sms-client.js";
import { recordAuthAudit } from "../../lib/auth/audit.js";
import { consumePhoneCode, issuePhoneCode } from "../../lib/auth/phone-code.js";
import { withTransaction } from "../../lib/database/transaction.js";
import { UnauthenticatedError } from "../../lib/errors/unauthorized-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import { normalizePhone } from "../../lib/phone/normalize-phone.js";
import type { RequestContext } from "../../types/request-context.js";
import type { UserRepository } from "../users/user.repository.js";
import type { IdentityRepository } from "./identity.repository.js";
import { checkPhoneSignIn } from "./phone.policy.js";
import type { PhoneRepository } from "./phone.repository.js";
import { announceSecurityChange } from "./security-events.js";
import type { SessionService } from "./session.service.js";

/**
 * Signing in with a phone number.
 *
 * A second way into an account, never the only one: an email address remains
 * what establishes it (`users.md:843`), so losing a number locks nobody out.
 *
 * Two rules shape everything here, and both are inherited rather than invented.
 *
 * ADR-081 requires that no authentication surface disclose whether an account
 * exists — "every future authentication surface inherits this obligation" — so
 * asking for a code answers identically whether the number is unknown,
 * unverified, dormant, or perfectly good.
 *
 * And the recycled-number problem shapes the rest. A carrier reassigns a
 * disconnected number to a stranger, who can then receive a code sent to it.
 * `phone.policy.ts` explains why dormancy is what is checked; what happens here
 * is the other half: a dormant number produces no text, and instead an email to
 * the account saying the number needs re-confirming. The stranger holding the
 * telephone learns nothing; the person holding the address learns what to do.
 */
export class PhoneService {
  /**
   * Build the phone service.
   *
   * @param dataSource - Opens the transactions this service's writes commit in.
   * @param phones - Where numbers are stored.
   * @param identities - Used to find the address a notice goes to.
   * @param sessions - Grants Sessions once a code has been accepted. Delegated
   *   rather than duplicated: a code and a magic link are different proofs of
   *   the same thing, and what follows must be identical.
   * @param sms - Sends codes. Records rather than sends until a provider
   *   exists.
   * @param email - Sends the notices that make a phone sign-in visible.
   * @param config - Code lifetime.
   * @param accounts - Resolves an Identity to the account it signs in to, so a
   *   security announcement can name who it concerns.
   * @param clock - Injected so tests can move time without waiting.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly phones: PhoneRepository,
    private readonly identities: IdentityRepository,
    private readonly sessions: SessionService,
    private readonly sms: SmsClient,
    private readonly email: EmailClient,
    private readonly config: AuthConfig,
    private readonly accounts: UserRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Claim a number, and send a code to prove it.
   *
   * @param identityId - Who is claiming.
   * @param phone - As typed, carrying its country.
   * @param context - Trace identifier and receipt time.
   * @returns Nothing.
   * @throws {ValidationError} If the number could not be dialled, or if
   *   somebody else already holds it. Unlike the sign-in surfaces, this one may
   *   say so: the caller is already signed in, so telling them a number is
   *   taken enumerates nothing they could not learn by trying to use it.
   */
  async claim(identityId: string, phone: string, context: RequestContext): Promise<void> {
    const normalizedPhone = normalizePhone(phone);

    if (normalizedPhone === undefined) {
      throw new ValidationError("That is not a phone number we can send to", { field: "phone" });
    }

    const existing = await this.phones.findByPhone(normalizedPhone);

    if (existing !== undefined && existing.identityId !== identityId) {
      throw new ValidationError("That number is already in use", { field: "phone" });
    }

    const at = this.clock();

    const code = await withTransaction(this.dataSource, async (tx) => {
      const claimed = await this.phones.claim(tx, identityId, normalizedPhone, phone, at);

      if (!claimed) {
        // Somebody claimed it between the read and the write. The database
        // decided, which is the point of the primary key.
        throw new ValidationError("That number is already in use", { field: "phone" });
      }

      const issued = await issuePhoneCode(tx, {
        normalizedPhone,
        purpose: "claim",
        ttlSeconds: this.config.phoneCodeTtlSeconds,
        now: at,
      });

      await recordAuthAudit(tx, {
        eventType: "phone_claimed",
        outcome: "success",
        identityId,
        traceId: context.traceId,
      });

      return issued.code;
    });

    // Sent outside the transaction: holding one open across a network call to a
    // carrier ties a database connection to somebody else's latency.
    await this.sms.send({
      to: normalizedPhone,
      text: `${code} is your Chronologity code. It expires in ${this.codeLifetimeMinutes()} minutes.`,
    });
  }

  /**
   * Confirm a claimed number with the code sent to it.
   *
   * @param identityId - Whose number.
   * @param code - What arrived by text.
   * @param context - Trace identifier and receipt time.
   * @returns Nothing.
   * @throws {ValidationError} If they hold no number, or the code is wrong,
   *   expired, already used, or has been guessed at too often. One refusal for
   *   all of them: the differences are what somebody guessing wants to learn.
   */
  async confirm(identityId: string, code: string, context: RequestContext): Promise<void> {
    const held = await this.phones.findByIdentity(identityId);

    if (held === undefined) {
      throw new ValidationError("That code is not valid", { field: "code" });
    }

    const at = this.clock();

    // The refusal commits, and is thrown afterwards. Throwing from inside the
    // transaction would roll back the wrong guess this just counted, which
    // would make guessing free — the exact thing the attempt counter exists to
    // prevent.
    const accepted = await withTransaction(this.dataSource, async (tx) => {
      const consumed = await consumePhoneCode(tx, {
        normalizedPhone: held.normalizedPhone,
        code,
        purpose: "claim",
        now: at,
      });

      await recordAuthAudit(tx, {
        eventType: consumed ? "phone_verified" : "phone_sign_in_rejected",
        outcome: consumed ? "success" : "failure",
        identityId,
        ...(consumed ? {} : { reason: "bad_claim_code" }),
        traceId: context.traceId,
      });

      if (consumed) {
        await this.phones.markVerified(tx, held.normalizedPhone, at);

        // Announced on confirmation rather than on the claim. An unproven
        // number is somebody typing digits; a proven one is a second way into
        // the account, which is what makes it worth telling them about.
        await announceSecurityChange(tx, this.accounts, {
          identityId,
          change: "phone_claimed",
          at,
          traceId: context.traceId,
        });
      }

      return consumed;
    });

    if (!accepted) {
      throw new ValidationError("That code is not valid", { field: "code" });
    }
  }

  /**
   * Remove the number an Identity holds.
   *
   * @param identityId - Whose number.
   * @param context - Trace identifier and receipt time.
   * @returns Nothing. Removing a number they do not hold is the state they
   *   asked for, not an error.
   */
  async remove(identityId: string, context: RequestContext): Promise<void> {
    const at = this.clock();

    await withTransaction(this.dataSource, async (tx) => {
      const removed = await this.phones.remove(tx, identityId);

      if (removed) {
        await recordAuthAudit(tx, {
          eventType: "phone_removed",
          outcome: "success",
          identityId,
          traceId: context.traceId,
        });

        // Removing the second factor is a step towards taking an account over,
        // so it is announced for the same reason adding one is.
        await announceSecurityChange(tx, this.accounts, {
          identityId,
          change: "phone_removed",
          at,
          traceId: context.traceId,
        });
      }
    });
  }

  /**
   * Read the number an Identity holds.
   *
   * @param identityId - Whose number.
   * @returns The number as typed and whether it is proven, or undefined when
   *   they hold none.
   */
  async held(
    identityId: string,
  ): Promise<{ phone: string; verified: boolean; dormant: boolean } | undefined> {
    const held = await this.phones.findByIdentity(identityId);

    if (held === undefined) {
      return undefined;
    }

    const refusal = checkPhoneSignIn(held, this.clock());

    return {
      phone: held.phone,
      verified: held.verifiedAt !== null,
      // Told to its holder deliberately. They are the one person who can act on
      // it, and they learn nothing about anybody else.
      dormant: refusal === "dormant",
    };
  }

  /**
   * Send a sign-in code to a number, if that is the right thing to do.
   *
   * Returns nothing whatever the number turns out to be. Whether a code was
   * sent is recorded in the audit trail, where it is useful, rather than
   * surfaced to the caller, where it would enumerate accounts (ADR-081).
   *
   * @param phone - As typed.
   * @param context - Trace identifier and receipt time.
   * @returns Nothing.
   */
  async requestSignInCode(phone: string, context: RequestContext): Promise<void> {
    const normalizedPhone = normalizePhone(phone);

    if (normalizedPhone === undefined) {
      return;
    }

    const held = await this.phones.findByPhone(normalizedPhone);

    if (held === undefined) {
      return;
    }

    const at = this.clock();
    const refusal = checkPhoneSignIn(held, at);

    if (refusal === "dormant") {
      await this.warnThatTheNumberWentQuiet(held.identityId, context);

      return;
    }

    if (refusal !== undefined) {
      return;
    }

    const code = await withTransaction(this.dataSource, (tx) =>
      issuePhoneCode(tx, {
        normalizedPhone,
        purpose: "login",
        ttlSeconds: this.config.phoneCodeTtlSeconds,
        now: at,
      }),
    );

    await this.sms.send({
      to: normalizedPhone,
      text: `${code.code} is your Chronologity sign-in code. It expires in ${this.codeLifetimeMinutes()} minutes.`,
    });
  }

  /**
   * Tell somebody, by email, that their number has gone quiet.
   *
   * The other half of the dormancy defence. Somebody asked to sign in with a
   * number this account holds and could not, and the only person who can do
   * anything about that is whoever holds the address — which, if the number was
   * recycled, is not whoever asked.
   *
   * @param identityId - Whose account.
   * @param context - Trace identifier, for the audit record.
   * @returns Nothing. A missing address is not an error: an Identity mid-way
   *   through registration may not have a verified one yet.
   */
  private async warnThatTheNumberWentQuiet(
    identityId: string,
    context: RequestContext,
  ): Promise<void> {
    await withTransaction(this.dataSource, (tx) =>
      recordAuthAudit(tx, {
        eventType: "phone_sign_in_rejected",
        outcome: "failure",
        identityId,
        reason: "dormant",
        traceId: context.traceId,
      }),
    );

    const address = await this.identities.findVerifiedEmailFor(identityId);

    if (address === undefined) {
      return;
    }

    await this.email.send({
      to: address,
      subject: "Confirm your phone number to keep using it to sign in",
      text: [
        "Someone tried to sign in to Chronologity using the phone number on your account.",
        "",
        "That number has not been used to sign in for a while, so we did not send a code.",
        "Phone numbers are sometimes reassigned to other people when they go unused,",
        "and we would rather ask than assume.",
        "",
        "Sign in with this email address and confirm your number to start using it again.",
        "If you no longer have that number, remove it from your account.",
      ].join("\n"),
    });
  }

  /**
   * Sign in with a number and the code sent to it.
   *
   * @param phone - As typed.
   * @param code - What arrived by text.
   * @param clientKind - A short description of the client, when it sent one.
   * @param context - Trace identifier and receipt time.
   * @returns The new Session's credentials.
   * @throws {UnauthenticatedError} If the number is unknown, unproven, dormant,
   *   or the code is wrong, expired, spent, or guessed at too often. All of
   *   them are one refusal, because the differences are exactly what somebody
   *   probing for accounts is trying to learn.
   */
  async signIn(
    phone: string,
    code: string,
    clientKind: string | undefined,
    context: RequestContext,
  ): Promise<SessionCredentials> {
    const normalizedPhone = normalizePhone(phone);

    if (normalizedPhone === undefined) {
      throw new UnauthenticatedError("That code is not valid");
    }

    const held = await this.phones.findByPhone(normalizedPhone);
    const at = this.clock();

    if (held === undefined || checkPhoneSignIn(held, at) !== undefined) {
      throw new UnauthenticatedError("That code is not valid");
    }

    // The refusal commits, and is thrown afterwards. Throwing from inside the
    // transaction would roll back the wrong guess this just counted, and a
    // wrong guess that costs nothing is no limit at all.
    const accepted = await withTransaction(this.dataSource, async (tx) => {
      const consumed = await consumePhoneCode(tx, {
        normalizedPhone,
        code,
        purpose: "login",
        now: at,
      });

      if (!consumed) {
        await recordAuthAudit(tx, {
          eventType: "phone_sign_in_rejected",
          outcome: "failure",
          identityId: held.identityId,
          reason: "bad_code",
          traceId: context.traceId,
        });

        return false;
      }

      // What keeps the number out of dormancy, written on every sign-in rather
      // than only the first.
      await this.phones.markSignedIn(tx, normalizedPhone, at);

      return true;
    });

    if (!accepted) {
      throw new UnauthenticatedError("That code is not valid");
    }

    const credentials = await this.sessions.issue({
      identityId: held.identityId,
      clientKind,
      method: "phone_code",
      context,
    });

    await this.announceSignIn(held.identityId);

    return credentials;
  }

  /**
   * Tell somebody, by email, that their number was just used to sign in.
   *
   * Prevention can fail — dormancy cannot see a SIM swap, where a carrier moves
   * a live number to somebody else's SIM. This is what makes that visible: the
   * real holder finds out the same minute, through a channel the attacker does
   * not hold.
   *
   * @param identityId - Whose account was entered.
   * @returns Nothing. A missing address is not an error.
   */
  private async announceSignIn(identityId: string): Promise<void> {
    const address = await this.identities.findVerifiedEmailFor(identityId);

    if (address === undefined) {
      return;
    }

    await this.email.send({
      to: address,
      subject: "Your phone number was used to sign in",
      text: [
        "Someone signed in to Chronologity using the phone number on your account.",
        "",
        "If that was you, there is nothing to do.",
        "",
        "If it was not, sign in with this email address, remove the number, and",
        "end any sessions you do not recognise.",
      ].join("\n"),
    });
  }

  /**
   * How long a code lasts, in whole minutes, for saying so in a message.
   *
   * @returns The lifetime in minutes, at least one.
   */
  private codeLifetimeMinutes(): number {
    return Math.max(1, Math.round(this.config.phoneCodeTtlSeconds / 60));
  }
}
