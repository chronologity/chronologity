import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import { NotFoundError } from "../../../lib/errors/not-found-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import {
  decideCheck,
  decideDerivativesProduced,
  decideFail,
  UPLOAD_CATEGORY,
} from "../aggregates/upload.aggregate.js";
import { derivativesFor } from "../derivative-policy.js";
import { clockFor, type UploadDependencies } from "../dependencies.js";
import {
  checkMedia,
  classifyMediaRejection,
  classifyProcessingError,
  describeMediaRejection,
  type FailureCategory,
} from "../media-policy.js";
import { uploadEventMetadata } from "../utils/event-metadata.js";
import {
  countAttempt,
  readStorageKey,
  recordDerivatives,
  recordUploadChecked,
  recordUploadFailed,
} from "../utils/upload-read-model.js";
import { derivativeContentType, derivativeKey } from "../utils/storage-key.js";
import { loadUpload } from "../utils/upload-store.js";
import type { CheckUploadCommand } from "./check-upload.command.js";

/**
 * Open an uploaded file and decide whether it may be used.
 *
 * This is where a claim becomes a fact. Everything before it recorded what the
 * uploader said; this reads the bytes and records what they are. An upload only
 * becomes usable here.
 *
 * The files needed to show the media are produced in the same pass, before the
 * upload is marked usable. Ordered that way so nothing can ever see an upload
 * claiming a preview that does not exist.
 *
 * Run from a queue, so it must survive being asked twice — at-least-once
 * delivery makes that ordinary rather than exceptional. Being asked to check a
 * file already checked does nothing and reports success.
 *
 * @param deps - Event store, database, storage, the decoder, limits, and clock.
 * @param command - Which upload to examine.
 * @param context - Trace identifier and receipt time.
 * @returns Whether the file was accepted. A refusal is a completed check
 *   rather than an error: the file was examined and found wanting, which is
 *   this function working, and the caller should not retry it.
 * @throws {NotFoundError} If there is no such upload, or it has been deleted.
 * @throws {Error} If the file could not be examined at all — storage
 *   unreachable, the decoder unavailable. Distinct from a refusal on purpose,
 *   because only this kind of failure is worth trying again.
 */
export async function handleCheckUpload(
  deps: UploadDependencies,
  command: CheckUploadCommand,
  context: RequestContext,
): Promise<boolean> {
  const at = clockFor(deps)();
  const { uploadId } = command.payload;

  const { state, revision } = await loadUpload(deps, uploadId);

  if (!state.exists || state.status === "deleted") {
    throw new NotFoundError("No such upload");
  }

  // Already settled. Both are ordinary: a note redelivered after the work was
  // done, or after the file was already refused.
  if (state.status === "ready") {
    return true;
  }

  if (state.status === "failed") {
    return false;
  }

  const storageKey = state.storageKey ?? (await readStorageKey(deps.pool, uploadId));

  if (storageKey === undefined) {
    throw new NotFoundError("No such upload");
  }

  // Counted before the work, so a file that reliably kills the decoder still
  // leaves evidence it was tried. Counting afterwards would let such a file be
  // retried forever, each attempt vanishing with the process.
  const attempt = await withTransaction(deps.pool, (tx) => countAttempt(tx, uploadId, at));

  let probe;

  try {
    // A short-lived read link rather than credentials: the decoder is handed a
    // URL and reads the ranges it needs, so nothing about storage's identity
    // travels into a subprocess.
    const url = await deps.storage.presignDownload(storageKey);
    probe = await deps.metadata.probe(url);
  } catch (error) {
    const category = classifyProcessingError(error);

    // Transient failures are rethrown so the queue can redeliver. Permanent
    // ones are recorded and settled here, because redelivering them would
    // reach the same answer at the same cost.
    if (category === "transient") {
      throw error;
    }

    await refuse(
      deps,
      uploadId,
      context,
      revision,
      "That file could not be read",
      category,
      attempt,
    );

    return false;
  }

  const verdict = checkMedia(probe, state.kind ?? "image");

  if (!verdict.ok) {
    await refuse(
      deps,
      uploadId,
      context,
      revision,
      describeMediaRejection(verdict.reason),
      classifyMediaRejection(verdict.reason),
      attempt,
    );

    return false;
  }

  const decision = decideCheck(state, {
    kind: verdict.kind,
    codec: probe.codec ?? "",
    container: probe.formats[0] ?? "",
    width: probe.width ?? 0,
    height: probe.height ?? 0,
    durationSeconds: verdict.durationSeconds,
    hasAudio: probe.hasAudio,
    now: at,
  });

  if (!decision.ok) {
    // Something settled the upload between loading it and deciding — another
    // checker, or a deletion. Its answer stands.
    return decision.reason === "already_checked";
  }

  // Produced before anything is recorded as usable. A failure here leaves the
  // upload unchecked and retriable, which is recoverable; the reverse would
  // leave something claiming a preview it does not have.
  let produced: readonly ("thumbnail" | "poster" | "faststart")[];

  try {
    produced = await produceDerivatives(deps, uploadId, storageKey, verdict.kind, state);
  } catch (error) {
    const category = classifyProcessingError(error);

    if (category === "transient") {
      throw error;
    }

    // Describable but not processable: a file the decoder could read enough of
    // to measure, and could not re-encode. Permanent, because a second attempt
    // reaches the same answer.
    await refuse(
      deps,
      uploadId,
      context,
      revision,
      "That file could not be prepared for display",
      category,
      attempt,
    );

    return false;
  }

  await withTransaction(deps.pool, async (tx) => {
    await recordUploadChecked(tx, {
      uploadId,
      kind: verdict.kind,
      codec: probe.codec ?? "",
      container: probe.formats[0] ?? "",
      width: probe.width ?? 0,
      height: probe.height ?? 0,
      durationSeconds: verdict.durationSeconds,
      hasAudio: probe.hasAudio,
      checkedAt: at,
    });

    await recordDerivatives(tx, uploadId, produced, at);
  });

  const derived = decideDerivativesProduced(state, { derivatives: produced, now: at });

  await appendEvents({
    client: deps.client,
    streamName: streamName(UPLOAD_CATEGORY, uploadId),
    // Both facts in one append, so history cannot show a checked upload whose
    // derivatives went missing between two writes.
    events: derived.ok ? [...decision.events, ...derived.events] : decision.events,
    metadata: uploadEventMetadata(context, undefined),
    expectedRevision: revision,
  });

  return true;
}

/**
 * Produce and store everything needed to show a piece of media.
 *
 * @param deps - Storage, the derivative tools, and the clock.
 * @param uploadId - Which upload.
 * @param storageKey - Where the original lives.
 * @param kind - What the file actually is, as measured.
 * @param state - The Upload, for its owner and what already exists.
 * @returns Everything that now exists, including anything produced earlier.
 * @throws {Error} If a derivative could not be produced or stored.
 */
async function produceDerivatives(
  deps: UploadDependencies,
  uploadId: string,
  storageKey: string,
  kind: "image" | "video",
  state: { ownerUserId: string | undefined; derivatives: readonly string[] },
): Promise<readonly ("thumbnail" | "poster" | "faststart")[]> {
  const owner = state.ownerUserId ?? "";
  const wanted = derivativesFor(kind);
  const existing = new Set(state.derivatives);

  // One link for all of them. Each tool reads the original independently, and
  // signing once keeps the number of signatures proportional to uploads rather
  // than to derivatives.
  const url = await deps.storage.presignDownload(storageKey);

  for (const derivative of wanted) {
    if (existing.has(derivative)) {
      continue;
    }

    const bytes =
      derivative === "thumbnail"
        ? await deps.derivatives.thumbnail(url)
        : derivative === "poster"
          ? await deps.derivatives.poster(url)
          : await deps.derivatives.faststart(url);

    await deps.storage.put(
      derivativeKey(owner, uploadId, derivative),
      bytes,
      derivativeContentType(derivative),
    );

    existing.add(derivative);
  }

  return [...existing] as readonly ("thumbnail" | "poster" | "faststart")[];
}

/**
 * Record that a file was examined and refused.
 *
 * @param deps - Event store, database, and clock.
 * @param uploadId - Which upload.
 * @param context - Trace identifier and receipt time.
 * @param revision - The revision the decision was made from.
 * @param reason - Why, in terms safe to show the upload's owner.
 * @param category - Whether trying again could ever help.
 * @param attempt - Which attempt this was.
 * @returns Nothing.
 */
async function refuse(
  deps: UploadDependencies,
  uploadId: string,
  context: RequestContext,
  revision: bigint | "no_stream",
  reason: string,
  category: FailureCategory,
  attempt: number,
): Promise<void> {
  const at = clockFor(deps)();
  const { state } = await loadUpload(deps, uploadId);

  // No acting User: a checker refuses on the product's behalf, not a person's.
  const decision = decideFail(state, {
    actorUserId: state.ownerUserId ?? "",
    reason,
    category,
    attempt,
    now: at,
  });

  if (!decision.ok) {
    return;
  }

  await withTransaction(deps.pool, async (tx) => {
    await recordUploadFailed(tx, uploadId, reason, category);
  });

  await appendEvents({
    client: deps.client,
    streamName: streamName(UPLOAD_CATEGORY, uploadId),
    events: decision.events,
    metadata: uploadEventMetadata(context, undefined),
    expectedRevision: revision,
  });
}
