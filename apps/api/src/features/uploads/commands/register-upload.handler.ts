import { randomUUID } from "node:crypto";
import type { UploadAuthorization } from "@chronologity/contracts";
import { withTransaction } from "../../../lib/database/transaction.js";
import { appendEvents } from "../../../lib/eventstore/append-events.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import { ValidationError } from "../../../lib/errors/validation-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import {
  decideRegister,
  initialUploadState,
  UPLOAD_CATEGORY,
} from "../aggregates/upload.aggregate.js";
import { clockFor, maximumBytesFor, type UploadDependencies } from "../dependencies.js";
import { uploadEventMetadata } from "../utils/event-metadata.js";
import { acceptedContentTypes, inferMediaKind } from "../utils/infer-media-kind.js";
import { originalKey } from "../utils/storage-key.js";
import { recordUploadRegistered } from "../utils/upload-read-model.js";
import type { RegisterUploadCommand } from "./register-upload.command.js";

/**
 * Authorise one upload.
 *
 * Produces a presigned URL permitting a single PUT to a single server-generated
 * key. The client uploads directly to storage from there; media bytes never
 * pass through the API (`media.md:184`).
 *
 * The declared size is checked against the limit here as a courtesy — refusing
 * before a large upload starts is kinder than refusing after — but it decides
 * nothing. What was actually stored is measured at finalization, which is the
 * check a client cannot lie to.
 *
 * @param deps - Event store, database, storage, limits, and clock.
 * @param command - Who is uploading and what they say they will send.
 * @param context - Trace identifier and receipt time.
 * @returns The upload identifier, the URL, and when each expires.
 * @throws {ValidationError} If the content type is not an accepted media type,
 *   or the declared size already exceeds the limit for its kind.
 */
export async function handleRegisterUpload(
  deps: UploadDependencies,
  command: RegisterUploadCommand,
  context: RequestContext,
): Promise<UploadAuthorization> {
  const at = clockFor(deps)();
  const { ownerUserId, declaredContentType, declaredByteSize } = command.payload;

  const kind = inferMediaKind(declaredContentType);

  if (kind === undefined) {
    throw new ValidationError(`Chronologity accepts ${acceptedContentTypes().join(", ")}`, {
      field: "contentType",
    });
  }

  const maximumByteSize = maximumBytesFor(deps, kind);

  if (declaredByteSize > maximumByteSize) {
    throw new ValidationError(`That file is larger than the ${kind} limit`, {
      field: "declaredByteSize",
      maximumByteSize,
    });
  }

  const uploadId = randomUUID();
  const storageKey = originalKey(ownerUserId, uploadId);
  const expiresAt = new Date(at.getTime() + deps.limits.registrationTtlSeconds * 1000);

  const decision = decideRegister(initialUploadState, {
    uploadId,
    ownerUserId,
    kind,
    declaredContentType,
    declaredByteSize,
    storageKey,
    expiresAt,
    now: at,
  });

  // The initial state is fixed and the identifier is new, so this cannot
  // refuse. Checked rather than asserted because a decision function is the
  // authority even when the caller is confident.
  if (!decision.ok) {
    throw new ValidationError("That upload could not be registered");
  }

  await withTransaction(deps.pool, async (tx) => {
    await recordUploadRegistered(tx, {
      uploadId,
      ownerUserId,
      kind,
      declaredContentType,
      declaredByteSize,
      storageKey,
      registeredAt: at,
      expiresAt,
    });
  });

  await appendEvents({
    client: deps.client,
    streamName: streamName(UPLOAD_CATEGORY, uploadId),
    events: decision.events,
    metadata: uploadEventMetadata(context, ownerUserId),
    expectedRevision: "no_stream",
  });

  // Signed last, so a failure anywhere above leaves no usable authorisation
  // behind. The URL's own expiry is shorter than the registration's: the
  // window to write is not the window to finish.
  const uploadUrl = await deps.storage.presignUpload(storageKey, declaredContentType);

  return {
    uploadId,
    kind,
    uploadUrl,
    contentType: declaredContentType,
    uploadUrlExpiresAt: new Date(
      at.getTime() + deps.storage.uploadUrlTtlSeconds * 1000,
    ).toISOString(),
    expiresAt: expiresAt.toISOString(),
    maximumByteSize,
  };
}
