import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import { NotFoundError } from "../../../lib/errors/not-found-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import { decideDelete, UPLOAD_CATEGORY } from "../aggregates/upload.aggregate.js";
import { clockFor, type UploadDependencies } from "../dependencies.js";
import { uploadEventMetadata } from "../utils/event-metadata.js";
import { readStorageKey, recordUploadDeleted } from "../utils/upload-read-model.js";
import { uploadPrefix } from "../utils/storage-key.js";
import { loadUpload } from "../utils/upload-store.js";
import type { DeleteUploadCommand } from "./delete-upload.command.js";

/**
 * Remove an upload and the object behind it.
 *
 * The stored objects are deleted after the domain transition commits. Ordered
 * that way deliberately: objects removed before the transition would leave a
 * failure looking like an upload that still exists but has no bytes, which is
 * the harder state to recover from. This way a failure leaves objects nobody
 * references, which is reclaimable.
 *
 * Everything under the upload's prefix goes, not only the original — a
 * photograph has a preview and a video has two derivatives, and leaving those
 * behind would mean deleted media still being served.
 *
 * @param deps - Event store, database, storage, and clock.
 * @param command - Which upload, and who is deleting it.
 * @param context - Trace identifier and receipt time.
 * @returns Nothing.
 * @throws {NotFoundError} If there is no such upload or it belongs to someone
 *   else. Deleting an already-deleted upload succeeds silently: its owner
 *   wants it gone, and it is.
 */
export async function handleDeleteUpload(
  deps: UploadDependencies,
  command: DeleteUploadCommand,
  context: RequestContext,
): Promise<void> {
  const at = clockFor(deps)();
  const { uploadId, actorUserId } = command.payload;

  const { state, revision } = await loadUpload(deps, uploadId);

  // Answered before the decision, because a deleted upload reads as absent to
  // everything downstream — including `decideDelete`, whose `already_deleted`
  // branch is therefore unreachable from here. Deleting something already gone
  // is what the caller asked for, so it succeeds rather than 404s.
  if (state.exists && state.status === "deleted" && state.ownerUserId === actorUserId) {
    return;
  }

  const storageKey = await readStorageKey(deps.pool, uploadId);
  const decision = decideDelete(state, { actorUserId, now: at });

  if (!decision.ok) {
    throw new NotFoundError("No such upload");
  }

  await withTransaction(deps.pool, async (tx) => {
    await recordUploadDeleted(tx, uploadId);
  });

  await appendEvents({
    client: deps.client,
    streamName: streamName(UPLOAD_CATEGORY, uploadId),
    events: decision.events,
    metadata: uploadEventMetadata(context, actorUserId),
    expectedRevision: revision,
  });

  // Listed rather than reconstructed. Deleting a fixed set of key shapes would
  // leave behind anything written by a version of the code that named things
  // differently, and deleted media that is still there is the worst kind of
  // bug to find later.
  const owner = state.ownerUserId;

  if (owner !== undefined) {
    for (const key of await deps.storage.list(uploadPrefix(owner, uploadId))) {
      await deps.storage.remove(key);
    }

    return;
  }

  if (storageKey !== undefined) {
    await deps.storage.remove(storageKey);
  }
}
