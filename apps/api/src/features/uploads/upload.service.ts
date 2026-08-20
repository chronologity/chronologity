import { randomUUID } from "node:crypto";
import {
  MEDIA_BOUNDARY,
  type DerivativeKind,
  type MediaKind,
  type RegisterUploadRequest,
  type Upload,
  type UploadAuthorization,
  type UploadReceivedPayload,
} from "@chronologity/contracts";
import type pg from "pg";
import { enqueueOutboxMessage } from "../../lib/database/outbox.js";
import { withTransaction, type Transaction } from "../../lib/database/transaction.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import type { DerivativeClient } from "../../integrations/metadata/derivative-client.js";
import type { MetadataClient } from "../../integrations/metadata/metadata-client.js";
import type { StorageClient } from "../../integrations/storage/storage-client.js";
import { topicName } from "../../lib/messaging/topics.js";
import type { Logger } from "../../lib/logger/logger.js";
import type { RequestContext } from "../../types/request-context.js";
import type { UploadLimits } from "../../config/storage-config.js";
import { missingDerivatives, withProduced } from "./upload.derivative-policy.js";
import {
  acceptedContentTypes,
  checkMedia,
  classifyMediaRejection,
  classifyProcessingError,
  describeMediaRejection,
  inferMediaKind,
} from "./upload.media-policy.js";
import type { UploadRepository } from "./upload.repository.js";
import {
  derivativeContentType,
  derivativeKey,
  originalKey,
  uploadPrefix,
} from "./upload.storage-key.js";
import type { UploadRecord } from "./upload.types.js";

/**
 * Media on its way in.
 *
 * The service owns the lifecycle: authorised, arrived, examined, refused,
 * removed. It does not own the bytes, but it does remember where they were put.
 *
 * An Upload belongs to a User rather than to a Moment. Media exists before
 * publication (`media.md:456`), and binding an Upload to a Moment at this point
 * would make drafts and abandonment impossible to represent.
 *
 * Arrival and readiness are deliberately different states. `received` means the
 * bytes are there and their size was checked; `ready` means the file was opened
 * and is what it claimed to be. Nothing should attach media to anything until
 * `ready`, or a Moment could reference a file nobody has looked at.
 *
 * Every transition is a conditional update naming the state it moves from, so
 * two checkers handed the same file cannot both believe they finished it.
 */
export interface UploadServiceOptions {
  /**
   * Reads what a file actually is.
   *
   * Only the checker needs it: the HTTP process authorises and verifies
   * uploads without ever opening one.
   */
  readonly metadata?: MetadataClient;
  /**
   * Produces the files that make media showable.
   *
   * Only the checker needs it: authorising and verifying an upload never
   * transforms one.
   */
  readonly derivatives?: DerivativeClient;
  readonly logger?: Logger;
  /** Injected so tests can move time without waiting. */
  readonly clock?: () => Date;
}

/** Authorising, verifying, examining, and removing media. */
export class UploadService {
  private readonly metadata: MetadataClient | undefined;
  private readonly derivatives: DerivativeClient | undefined;
  private readonly logger: Logger | undefined;
  private readonly clock: () => Date;

  /**
   * Build the Upload service.
   *
   * @param pool - Opens the transactions this service's writes commit in.
   * @param uploads - Where uploads are stored.
   * @param storage - Object storage. Bytes never travel through the API.
   * @param limits - Size ceilings and how long a registration stays open.
   * @param options - The decoder and derivative tools, which only the checker
   *   needs, plus an optional logger and clock.
   */
  constructor(
    private readonly pool: pg.Pool,
    private readonly uploads: UploadRepository,
    private readonly storage: StorageClient,
    private readonly limits: UploadLimits,
    options: UploadServiceOptions = {},
  ) {
    this.metadata = options.metadata;
    this.derivatives = options.derivatives;
    this.logger = options.logger;
    this.clock = options.clock ?? (() => new Date());
  }

  /**
   * Authorise an upload.
   *
   * Nothing is uploaded through the API. What this produces is permission to
   * write one object directly to storage, bounded in time and bound to a key
   * the server chose.
   *
   * @param ownerUserId - Who is uploading.
   * @param request - What they say they are about to upload.
   * @returns Where to write it, until when, and the ceiling that applies.
   * @throws {ValidationError} If the declared type is not accepted, or the
   *   declared size exceeds the limit for its kind.
   */
  async register(
    ownerUserId: string,
    request: RegisterUploadRequest,
  ): Promise<UploadAuthorization> {
    const at = this.clock();
    const { contentType: declaredContentType, declaredByteSize } = request;

    const kind = inferMediaKind(declaredContentType);

    if (kind === undefined) {
      throw new ValidationError("That file type is not accepted", {
        field: "contentType",
        accepted: acceptedContentTypes(),
      });
    }

    const maximumByteSize = this.maximumBytesFor(kind);

    if (declaredByteSize > maximumByteSize) {
      throw new ValidationError(`That file is larger than the ${kind} limit`, {
        field: "declaredByteSize",
        maximumByteSize,
      });
    }

    const uploadId = randomUUID();
    const storageKey = originalKey(ownerUserId, uploadId);
    const expiresAt = new Date(at.getTime() + this.limits.registrationTtlSeconds * 1000);

    await withTransaction(this.pool, (tx) =>
      this.uploads.insert(tx, {
        uploadId,
        ownerUserId,
        kind,
        declaredContentType,
        declaredByteSize,
        storageKey,
        registeredAt: at,
        expiresAt,
      }),
    );

    // Signed last, so a failure anywhere above leaves no usable authorisation
    // behind. The URL's own expiry is shorter than the registration's: the
    // window to write is not the window to finish.
    const uploadUrl = await this.storage.presignUpload(storageKey, declaredContentType);

    return {
      uploadId,
      kind,
      uploadUrl,
      contentType: declaredContentType,
      uploadUrlExpiresAt: new Date(
        at.getTime() + this.storage.uploadUrlTtlSeconds * 1000,
      ).toISOString(),
      expiresAt: expiresAt.toISOString(),
      maximumByteSize,
    };
  }

  /**
   * Verify that what arrived is what was authorised.
   *
   * Storage is asked what is actually at the key, because a client that
   * declared one thing and wrote another would otherwise go unnoticed until
   * something tried to display it.
   *
   * @param uploadId - Which upload.
   * @param actorUserId - Who is finalizing. Must be its owner.
   * @param context - Trace identifier, carried onto the message that announces
   *   the arrival.
   * @returns Nothing. Finalizing an upload already received is silently
   *   idempotent: retrying after a lost response is ordinary client behaviour.
   * @throws {NotFoundError} If there is no such upload, it was deleted, or it
   *   belongs to somebody else. All three answer identically.
   * @throws {ValidationError} If nothing was uploaded, the object is larger
   *   than the limit, its type contradicts what was declared, or the
   *   authorisation has expired.
   */
  async finalize(uploadId: string, actorUserId: string, context: RequestContext): Promise<void> {
    const at = this.clock();
    const record = await this.requireOwned(uploadId, actorUserId);

    // Already done. Idempotent rather than an error: the caller asked for a
    // state that already holds.
    if (record.status === "received" || record.status === "ready") {
      return;
    }

    const stored = await this.storage.head(record.storageKey);

    if (stored === undefined) {
      await this.refuse(uploadId, "Nothing was uploaded");

      throw new ValidationError("Nothing was uploaded to that authorisation");
    }

    const maximumByteSize = this.maximumBytesFor(record.kind);

    if (stored.byteSize > maximumByteSize) {
      // Deleted, not merely refused. The client wrote it with a signature that
      // could not bound its length, so the object exists and is being paid for
      // until something removes it.
      await this.storage.remove(record.storageKey);
      await this.refuse(uploadId, "That file is larger than the limit");

      throw new ValidationError("That file is larger than the limit", { maximumByteSize });
    }

    // Storage reports the type the client set at upload time, so this catches a
    // client contradicting itself rather than one lying consistently. What the
    // bytes actually decode to is established when the file is opened.
    if (stored.contentType !== undefined && inferMediaKind(stored.contentType) !== record.kind) {
      await this.storage.remove(record.storageKey);
      await this.refuse(uploadId, "The uploaded file was not the declared type");

      throw new ValidationError("The uploaded file was not the declared type");
    }

    // Checked here rather than only at the storage layer: a presigned URL may
    // have expired while the registration is still open, or the reverse. The
    // registration is what authorises the Upload to exist at all.
    if (record.expiresAt <= at) {
      // The object is orphaned: it was written under an authorisation that has
      // since lapsed, and nothing will ever claim it.
      await this.storage.remove(record.storageKey);
      await this.refuse(uploadId, "That upload authorisation expired");

      throw new ValidationError("That upload authorisation expired");
    }

    // A false result means something settled it between the read and the
    // write — a concurrent finalize, or a deletion. Its answer stands, and a
    // retried finalize is not an error.
    await withTransaction(this.pool, async (tx) => {
      const received = await this.uploads.markReceived(tx, {
        uploadId,
        byteSize: stored.byteSize,
        contentType: stored.contentType,
        checksum: stored.entityTag,
        receivedAt: at,
      });

      if (!received) {
        return false;
      }

      // Enqueued in the same transaction as the arrival it announces, so
      // either both land or neither does (ADR-093).
      await this.announceArrival(tx, record, at, context);

      return true;
    });
  }

  /**
   * Open a file, establish what it is, and prepare it for display.
   *
   * Called from a queue where the same file will be offered more than once, so
   * every step is written to be safe when repeated.
   *
   * @param uploadId - Which upload.
   * @returns True if the file is now ready, false if it was refused. Both are
   *   answers; only an inability to look at the file at all is a failure.
   * @throws {NotFoundError} If there is no such upload or it was deleted.
   * @throws {Error} If the file could not be examined at all — storage
   *   unreachable, the decoder unavailable. Distinct from a refusal on purpose,
   *   because only this kind of failure is worth trying again.
   */
  async check(uploadId: string): Promise<boolean> {
    const at = this.clock();
    const record = await this.uploads.findRecord(uploadId);

    if (record === undefined || record.status === "deleted") {
      throw new NotFoundError("No such upload");
    }

    // Already settled. Both are ordinary: a note redelivered after the work was
    // done, or after the file was already refused.
    if (record.status === "ready") {
      return true;
    }

    if (record.status === "failed") {
      return false;
    }

    if (this.metadata === undefined || this.derivatives === undefined) {
      throw new Error("This process cannot examine media");
    }

    // Counted before the work, so a file that reliably kills the decoder still
    // leaves evidence it was tried. Counting afterwards would let such a file be
    // retried forever, each attempt vanishing with the process.
    await withTransaction(this.pool, (tx) => this.uploads.countAttempt(tx, uploadId, at));

    let probe;

    try {
      // A short-lived read link rather than credentials: the decoder is handed
      // a URL and reads the ranges it needs, so nothing about storage's
      // identity travels into a subprocess.
      const url = await this.storage.presignDownload(record.storageKey);
      probe = await this.metadata.probe(url);
    } catch (error) {
      // Transient failures are rethrown so the queue can redeliver. Permanent
      // ones are recorded and settled here, because redelivering them would
      // reach the same answer at the same cost.
      if (classifyProcessingError(error) === "transient") {
        throw error;
      }

      await this.refuse(uploadId, "That file could not be read", "permanent");

      return false;
    }

    const verdict = checkMedia(probe, record.kind);

    if (!verdict.ok) {
      await this.refuse(
        uploadId,
        describeMediaRejection(verdict.reason),
        classifyMediaRejection(verdict.reason),
      );

      return false;
    }

    // Produced before anything is recorded as usable. A failure here leaves the
    // upload unchecked and retriable, which is recoverable; the reverse would
    // leave something claiming a preview it does not have.
    let produced: readonly DerivativeKind[];

    try {
      produced = await this.produceDerivatives(record, verdict.kind, this.derivatives);
    } catch (error) {
      if (classifyProcessingError(error) === "transient") {
        throw error;
      }

      // Describable but not processable: a file the decoder could read enough
      // of to measure, and could not re-encode. Permanent, because a second
      // attempt reaches the same answer.
      await this.refuse(uploadId, "That file could not be prepared for display", "permanent");

      return false;
    }

    const moved = await withTransaction(this.pool, (tx) =>
      this.uploads.markReady(tx, {
        uploadId,
        kind: verdict.kind,
        // Taken from the verdict rather than the probe: accepting the file is
        // what established these, and reading them off the probe again would
        // mean inventing fallbacks for values that are already guaranteed.
        codec: verdict.codec,
        container: verdict.container,
        width: verdict.width,
        height: verdict.height,
        durationSeconds: verdict.durationSeconds,
        hasAudio: probe.hasAudio,
        derivatives: produced,
        checkedAt: at,
      }),
    );

    if (!moved) {
      // Another checker finished it, or it was deleted, while this one worked.
      // Its answer stands, and the work done here was wasted rather than wrong.
      this.logger?.debug({ uploadId }, "Upload was settled by another checker");
    }

    return true;
  }

  /**
   * Remove an upload and, by consequence, its stored objects.
   *
   * @param uploadId - Which upload.
   * @param actorUserId - Who is deleting it. Must be its owner.
   * @returns Nothing. Deleting something already gone is what the caller asked
   *   for, so it succeeds rather than answering absent.
   * @throws {NotFoundError} If there is no such upload or it belongs to
   *   somebody else.
   */
  async delete(uploadId: string, actorUserId: string): Promise<void> {
    const record = await this.uploads.findRecord(uploadId);

    if (record === undefined || record.ownerUserId !== actorUserId) {
      throw new NotFoundError("No such upload");
    }

    if (record.status === "deleted") {
      return;
    }

    await withTransaction(this.pool, (tx) => this.uploads.markDeleted(tx, uploadId, actorUserId));

    // Listed rather than reconstructed. Deleting a fixed set of key shapes
    // would leave behind anything written by a version of the code that named
    // things differently, and deleted media that is still there is the worst
    // kind of bug to find later.
    //
    // After the transition commits: a failure here leaves objects nobody
    // references, which is reclaimable, while the reverse would leave a live
    // upload whose bytes are gone.
    for (const key of await this.storage.list(uploadPrefix(record.ownerUserId, uploadId))) {
      await this.storage.remove(key);
    }
  }

  /**
   * Read one upload.
   *
   * @param uploadId - Which upload.
   * @param actorUserId - Who is asking.
   * @returns The upload as its owner sees it.
   * @throws {NotFoundError} If there is no such upload, it has been deleted, or
   *   it belongs to somebody else. All three answer identically: whether
   *   another person's upload exists is not the caller's business.
   */
  async get(uploadId: string, actorUserId: string): Promise<Upload> {
    await this.requireOwned(uploadId, actorUserId);

    const upload = await this.uploads.findById(uploadId);

    if (upload === undefined) {
      throw new NotFoundError("No such upload");
    }

    return upload;
  }

  /**
   * List somebody's uploads.
   *
   * @param ownerUserId - Whose uploads.
   * @param limit - How many at most.
   * @returns Their uploads, most recent first.
   */
  async list(ownerUserId: string, limit: number): Promise<Upload[]> {
    return this.uploads.findForOwner(ownerUserId, limit);
  }

  /**
   * Produce and store everything needed to show a piece of media.
   *
   * @param record - The upload, for its owner, its key, and what already exists.
   * @param kind - What the file actually is, as measured.
   * @param tools - The derivative producers.
   * @returns Everything that now exists, including anything produced earlier.
   * @throws {Error} If a derivative could not be produced or stored.
   */
  private async produceDerivatives(
    record: UploadRecord,
    kind: MediaKind,
    tools: DerivativeClient,
  ): Promise<readonly DerivativeKind[]> {
    const wanted = missingDerivatives(kind, record.derivatives);

    if (wanted.length === 0) {
      return record.derivatives;
    }

    // One link for all of them. Each tool reads the original independently, and
    // signing once keeps the number of signatures proportional to uploads
    // rather than to derivatives.
    const url = await this.storage.presignDownload(record.storageKey);
    const made: DerivativeKind[] = [];

    for (const derivative of wanted) {
      const bytes =
        derivative === "thumbnail"
          ? await tools.thumbnail(url)
          : derivative === "poster"
            ? await tools.poster(url)
            : await tools.faststart(url);

      await this.storage.put(
        derivativeKey(record.ownerUserId, record.uploadId, derivative),
        bytes,
        derivativeContentType(derivative),
      );

      made.push(derivative);
    }

    return withProduced(record.derivatives, made);
  }

  /**
   * Record that an upload was refused.
   *
   * @param uploadId - Which upload.
   * @param reason - Why, in terms safe to show the upload's owner.
   * @param category - Whether trying again could ever help.
   * @returns Nothing. A refusal that finds the upload already settled does
   *   nothing: the first answer is the one that ended it, and overwriting it
   *   would lose why.
   */
  private async refuse(
    uploadId: string,
    reason: string,
    category: "transient" | "permanent" = "permanent",
  ): Promise<void> {
    await withTransaction(this.pool, (tx) =>
      this.uploads.markFailed(tx, uploadId, reason, category),
    );
  }

  /**
   * Announce that media arrived, for whatever processes it.
   *
   * The translation is deliberate rather than a copy (ADR-096). An Upload's
   * record holds what the uploader claimed about size and content type, kept so
   * a later mismatch is answerable — not something a consumer should act on, so
   * it does not cross the boundary. What does cross is only what a processor
   * needs: which upload, whose it is, what it claims to be, and where to read
   * it.
   *
   * Arrival is the only thing published. Registration is an intention rather
   * than a fact about a file; failure and deletion are the API's own business
   * until something outside needs them. None of the three has a consumer, and
   * publishing without one is how internal state quietly becomes a contract.
   *
   * @param tx - The transaction carrying the arrival.
   * @param record - The upload that arrived.
   * @param at - When it arrived.
   * @param context - Trace identifier, so the hop into asynchronous processing
   *   stays joined to the request that caused it.
   * @returns Nothing.
   */
  private async announceArrival(
    tx: Transaction,
    record: UploadRecord,
    at: Date,
    context: RequestContext,
  ): Promise<void> {
    const payload: UploadReceivedPayload = {
      uploadId: record.uploadId,
      ownerUserId: record.ownerUserId,
      kind: record.kind,
      storageKey: record.storageKey,
      receivedAt: at.toISOString(),
    };

    await enqueueOutboxMessage(tx, {
      topic: topicName(MEDIA_BOUNDARY),
      // Ordered per upload: two notes about the same file must not be handled
      // out of sequence.
      partitionKey: record.uploadId,
      aggregateType: "upload",
      aggregateId: record.uploadId,
      aggregateVersion: 0,
      eventType: "UploadReceived",
      eventVersion: 1,
      payload,
      metadata: {
        traceId: context.traceId,
        correlationId: context.traceId,
        causationId: undefined,
        actorUserId: record.ownerUserId,
        eventVersion: 1,
        recordedAt: context.receivedAt.toISOString(),
      },
    });
  }

  /**
   * Load an upload the actor is entitled to act on.
   *
   * Ownership is checked here rather than in a route so that no caller can
   * reach a transition without passing it. A deleted upload reads as absent:
   * its owner asked for it to be gone, and reporting it as present but unusable
   * would contradict that.
   *
   * @param uploadId - Which upload.
   * @param actorUserId - Who is acting.
   * @returns The stored record.
   * @throws {NotFoundError} If there is no such upload, it is deleted, or it
   *   belongs to somebody else.
   */
  private async requireOwned(uploadId: string, actorUserId: string): Promise<UploadRecord> {
    const record = await this.uploads.findRecord(uploadId);

    if (record === undefined || record.status === "deleted" || record.ownerUserId !== actorUserId) {
      throw new NotFoundError("No such upload");
    }

    return record;
  }

  /**
   * The size limit for a media kind.
   *
   * @param kind - Which kind of media.
   * @returns The maximum in bytes. Video is larger than image because ninety
   *   seconds of video is inherently larger than a photograph, not because
   *   video is more privileged.
   */
  private maximumBytesFor(kind: MediaKind): number {
    return kind === "video" ? this.limits.maxVideoBytes : this.limits.maxImageBytes;
  }
}
