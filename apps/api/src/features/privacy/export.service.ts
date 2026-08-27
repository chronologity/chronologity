import type { ExportStatus } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import type { AuthConfig } from "../../config/auth-config.js";
import type { EmailClient } from "../../integrations/email/email-client.js";
import type { StorageClient } from "../../integrations/storage/storage-client.js";
import { recordAuthAudit } from "../../lib/auth/audit.js";
import { consumeMagicLink, issueMagicLink } from "../../lib/auth/magic-link.js";
import { withTransaction } from "../../lib/database/transaction.js";
import { UnauthenticatedError } from "../../lib/errors/unauthorized-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import { generateId } from "../../lib/ids/generate-id.js";
import type { RequestContext } from "../../types/request-context.js";
import {
  linkLifetimeMinutes,
  linkUrlFor,
  normalizeEmail,
} from "../authentication/authentication.policy.js";
import type { IdentityRepository } from "../authentication/identity.repository.js";
import type { ExportSourceRepository } from "./export-source.repository.js";
import { DOWNLOAD_URL_TTL_SECONDS, hasExpired, partName } from "./export.policy.js";
import type { ExportRepository } from "./export.repository.js";

/**
 * Asking for a copy of your history, and finding out where it is.
 *
 * Preparing one takes two steps for the same reason deleting an account does: a
 * session shows somebody signed in once, and an export is everything the person
 * has. Consuming a fresh link shows they can read the mailbox now, and the mail
 * arriving means a stranger holding a stolen session cannot quietly take a copy
 * of somebody's entire history.
 *
 * What this service never does is build one. Assembling a history of ten
 * thousand Moments is unbounded work and belongs to the worker; this writes
 * down that it was asked for, and afterwards describes where the result is.
 */
export class ExportService {
  /**
   * Build the export service.
   *
   * @param dataSource - Opens the transactions this service's writes commit in.
   * @param exports - The record of exports being prepared.
   * @param identities - Where the address the link goes to lives.
   * @param sources - Read when a manifest is built, for the media to sign.
   * @param storage - Signs the short-lived URLs.
   * @param email - Sends the confirmation link.
   * @param config - Link lifetime and the base URL links point at.
   * @param clock - Injected so tests can move time without waiting.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly exports: ExportRepository,
    private readonly identities: IdentityRepository,
    private readonly sources: ExportSourceRepository,
    private readonly storage: StorageClient,
    private readonly email: EmailClient,
    private readonly config: AuthConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Ask for an export, and send the link that confirms it.
   *
   * @param identityId - The signed-in Identity.
   * @param context - Trace identifier and receipt time.
   * @returns Nothing.
   * @throws {ValidationError} If the account has no verified address. Nothing
   *   could prove control of it, and preparing a copy of somebody's history on
   *   a session alone is the weaker thing this step exists to avoid.
   */
  async request(identityId: string, context: RequestContext): Promise<void> {
    const at = this.clock();
    const address = await this.identities.findVerifiedEmailFor(identityId);

    if (address === undefined) {
      throw new ValidationError(
        "This account has no verified email address to confirm an export with",
      );
    }

    const link = await withTransaction(this.dataSource, async (tx) => {
      await recordAuthAudit(tx, {
        eventType: "data_export_requested",
        outcome: "success",
        identityId,
        traceId: context.traceId,
      });

      return issueMagicLink(tx, {
        email: normalizeEmail(address),
        purpose: "confirm_export",
        ttlSeconds: this.config.magicLinkTtlSeconds,
        now: at,
      });
    });

    await this.email.send({
      to: address,
      subject: "Confirm that you want a copy of your Chronologity history",
      text: [
        "You asked for a copy of everything you have recorded on Chronologity.",
        "",
        `Confirm here: ${linkUrlFor(this.config.magicLinkBaseUrl, "confirm_export", link.token)}`,
        "",
        `The link stops working in ${linkLifetimeMinutes(this.config.magicLinkTtlSeconds)} minutes.`,
        "",
        "Preparing it takes a while for a large history. Once it is ready you can download it for a few days, after which it is removed.",
        "",
        "If you did not ask for this, somebody else may have access to your account. Change your password and sign out of every device.",
      ].join("\n"),
    });
  }

  /**
   * Confirm it, and write down that the work is owed.
   *
   * @param userId - Whose account.
   * @param identityId - The signed-in Identity, which the link must belong to.
   * @param token - The raw token from the confirmation link.
   * @param context - Trace identifier and receipt time.
   * @returns Nothing. Confirming while one is already being prepared changes
   *   nothing: two builds of the same history would each sweep the other's
   *   objects.
   * @throws {UnauthenticatedError} If the link is unknown, expired, already
   *   used, of another purpose, or belongs to a different Identity. All five
   *   answer identically.
   */
  async confirm(
    userId: string,
    identityId: string,
    token: string,
    context: RequestContext,
  ): Promise<void> {
    const at = this.clock();

    await withTransaction(this.dataSource, async (tx) => {
      const consumed = await consumeMagicLink(tx, {
        token,
        purpose: "confirm_export",
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

      // The link proves control of an address; this proves it is this account's
      // address. Without it, a link issued for one account would export
      // whichever account happened to be signed in.
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

      await this.exports.request(tx, { requestId: generateId(), userId, at });
    });
  }

  /**
   * Where somebody's export is, and how to fetch it.
   *
   * @param userId - Whose.
   * @returns Its state, and a manifest when there is one to give. Every URL in
   *   the manifest is signed now and lives for minutes, because a URL signed
   *   when the export was built would still work days later — which is the same
   *   as no expiry for anybody who kept the manifest.
   * @throws {ValidationError} If no export has ever been asked for, which is
   *   different from one that failed and should read differently.
   */
  async status(userId: string): Promise<ExportStatus> {
    const request = await this.exports.findLatest(userId);

    if (request === undefined) {
      throw new ValidationError("No export has been prepared for this account");
    }

    const at = this.clock();
    const expired = hasExpired(request.expiresAt ?? undefined, at);
    const state = request.state === "ready" && expired ? "expired" : request.state;

    const status: ExportStatus = {
      state: state as ExportStatus["state"],
      requestedAt: request.requestedAt.toISOString(),
      completedAt: request.completedAt?.toISOString() ?? null,
      expiresAt: request.expiresAt?.toISOString() ?? null,
    };

    if (state !== "ready" || request.storagePrefix === null || request.partCount === null) {
      return status;
    }

    return { ...status, manifest: await this.manifest(userId, request) };
  }

  /**
   * Build a manifest with links that work for minutes.
   *
   * @param userId - Whose export.
   * @param request - The prepared export.
   * @returns Where every part and every file is.
   */
  private async manifest(
    userId: string,
    request: { storagePrefix: string | null; partCount: number | null; expiresAt: Date | null; completedAt: Date | null },
  ): Promise<NonNullable<ExportStatus["manifest"]>> {
    const prefix = request.storagePrefix ?? "";
    const parts = [];

    for (let index = 1; index <= (request.partCount ?? 0); index += 1) {
      const name = partName(index);

      parts.push({
        name,
        url: await this.storage.presignDownload(`${prefix}/${name}`, DOWNLOAD_URL_TTL_SECONDS),
      });
    }

    // Read now rather than recorded when the export was built. Somebody who has
    // deleted a Moment since should not be handed its photographs by a manifest
    // prepared before they did, and current state is the only thing that knows.
    const media = [];

    for (const file of await this.sources.mediaToSign(userId)) {
      media.push({
        uploadId: file.uploadId,
        kind: file.kind,
        contentType: file.contentType,
        byteSize: file.byteSize,
        url: await this.storage.presignDownload(file.storageKey, DOWNLOAD_URL_TTL_SECONDS),
      });
    }

    return {
      preparedAt: (request.completedAt ?? new Date()).toISOString(),
      expiresAt: (request.expiresAt ?? new Date()).toISOString(),
      parts,
      media,
    };
  }
}
