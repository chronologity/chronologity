import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import { NotFoundError } from "../../../lib/errors/not-found-error.js";
import { ValidationError } from "../../../lib/errors/validation-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import { decideFail, decideFinalize, UPLOAD_CATEGORY } from "../aggregates/upload.aggregate.js";
import { clockFor, maximumBytesFor, type UploadDependencies } from "../dependencies.js";
import { uploadEventMetadata } from "../utils/event-metadata.js";
import { inferMediaKind } from "../utils/infer-media-kind.js";
import {
  readStorageKey,
  recordUploadFailed,
  recordUploadReceived,
} from "../utils/upload-read-model.js";
import { loadUpload } from "../utils/upload-store.js";
import type { FinalizeUploadCommand } from "./finalize-upload.command.js";

/**
 * Accept an upload, after checking what is actually stored.
 *
 * The client saying "uploaded" establishes nothing (`media.md:236`). This asks
 * storage what is at the key and decides on that: an object that is absent,
 * oversized, or a different media type than declared is refused, and an
 * oversized object is deleted rather than left occupying storage nobody
 * intends to pay for.
 *
 * What this cannot yet check is whether the bytes are the media they claim to
 * be. Storage reports the content type the client set at upload time, so this
 * catches contradiction rather than deception. Decoding the file — and with it
 * the ninety-second video limit — is 5E-2's work.
 *
 * @param deps - Event store, database, storage, limits, and clock.
 * @param command - Which upload, and who is finalizing it.
 * @param context - Trace identifier and receipt time.
 * @returns Nothing.
 * @throws {NotFoundError} If there is no such upload, or it belongs to someone
 *   else. Both answer identically: whether another person's upload exists is
 *   not the caller's business.
 * @throws {ValidationError} If the registration has lapsed, or the stored
 *   object is missing, oversized, or contradicts what was declared.
 */
export async function handleFinalizeUpload(
  deps: UploadDependencies,
  command: FinalizeUploadCommand,
  context: RequestContext,
): Promise<void> {
  const at = clockFor(deps)();
  const { uploadId, actorUserId } = command.payload;

  const { state, revision } = await loadUpload(deps, uploadId);

  // Ownership before storage: a caller who does not own this upload should not
  // be able to learn whether its object exists by timing the response.
  if (!state.exists || state.status === "deleted" || state.ownerUserId !== actorUserId) {
    throw new NotFoundError("No such upload");
  }

  if (state.status === "received") {
    // Already done. Idempotent rather than an error: the caller asked for a
    // state that already holds, and retrying a finalize after a lost response
    // is ordinary client behaviour.
    return;
  }

  const storageKey = await readStorageKey(deps.pool, uploadId);

  if (storageKey === undefined) {
    throw new NotFoundError("No such upload");
  }

  const stored = await deps.storage.head(storageKey);

  if (stored === undefined) {
    await refuse(deps, command, context, revision, "Nothing was uploaded");
    throw new ValidationError("Nothing was uploaded to that authorisation");
  }

  const maximumByteSize = maximumBytesFor(deps, state.kind ?? "image");

  if (stored.byteSize > maximumByteSize) {
    // Deleted, not merely refused. The client wrote it with a signature that
    // could not bound its length, so the object exists and is being paid for
    // until something removes it.
    await deps.storage.remove(storageKey);
    await refuse(deps, command, context, revision, "That file is larger than the limit");

    throw new ValidationError("That file is larger than the limit", { maximumByteSize });
  }

  // Storage reports the type the client set at upload time, so this catches a
  // client contradicting itself rather than one lying consistently. 5E-2
  // replaces it with what the bytes decode to.
  if (stored.contentType !== undefined && inferMediaKind(stored.contentType) !== state.kind) {
    await deps.storage.remove(storageKey);
    await refuse(deps, command, context, revision, "The uploaded file was not the declared type");

    throw new ValidationError("The uploaded file was not the declared type");
  }

  const decision = decideFinalize(state, {
    actorUserId,
    byteSize: stored.byteSize,
    contentType: stored.contentType,
    checksum: stored.entityTag,
    now: at,
  });

  if (!decision.ok) {
    if (decision.reason === "registration_expired") {
      // The object is orphaned: it was written under an authorisation that has
      // since lapsed, and nothing will ever claim it.
      await deps.storage.remove(storageKey);
      await refuse(deps, command, context, revision, "That upload authorisation expired");

      throw new ValidationError("That upload authorisation expired");
    }

    throw new ValidationError("That upload could not be completed");
  }

  await withTransaction(deps.pool, async (tx) => {
    await recordUploadReceived(tx, {
      uploadId,
      byteSize: stored.byteSize,
      contentType: stored.contentType,
      checksum: stored.entityTag,
      receivedAt: at,
    });
  });

  await appendEvents({
    client: deps.client,
    streamName: streamName(UPLOAD_CATEGORY, uploadId),
    events: decision.events,
    metadata: uploadEventMetadata(context, actorUserId),
    expectedRevision: revision,
  });
}

/**
 * Record that an upload was refused.
 *
 * Separated because every refusal path does the same three things, and a
 * refusal that failed to persist would leave an upload stuck in `registered`
 * with nothing explaining why it never completed.
 *
 * @param deps - Event store, database, and clock.
 * @param command - Which upload and who was acting.
 * @param context - Trace identifier and receipt time.
 * @param revision - The revision the decision was made from.
 * @param reason - Why, in terms safe to show the upload's owner.
 * @returns Nothing.
 */
async function refuse(
  deps: UploadDependencies,
  command: FinalizeUploadCommand,
  context: RequestContext,
  revision: bigint | "no_stream",
  reason: string,
): Promise<void> {
  const at = clockFor(deps)();
  const { uploadId, actorUserId } = command.payload;

  const { state } = await loadUpload(deps, uploadId);
  const decision = decideFail(state, { actorUserId, reason, now: at });

  if (!decision.ok) {
    return;
  }

  await withTransaction(deps.pool, async (tx) => {
    await recordUploadFailed(tx, uploadId, reason);
  });

  await appendEvents({
    client: deps.client,
    streamName: streamName(UPLOAD_CATEGORY, uploadId),
    events: decision.events,
    metadata: uploadEventMetadata(context, actorUserId),
    expectedRevision: revision,
  });
}
