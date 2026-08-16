import type { Upload } from "@chronologity/contracts";
import { NotFoundError } from "../../../lib/errors/not-found-error.js";
import type { UploadDependencies } from "../dependencies.js";
import { loadUpload } from "../utils/upload-store.js";
import { readUpload } from "../utils/upload-read-model.js";
import type { GetUploadByIdQuery } from "./get-upload-by-id.query.js";

/**
 * Read one upload.
 *
 * Ownership is checked against the aggregate rather than the read model. The
 * read model is derived and could lag; who owns an upload is a fact history
 * settles, and an authorization decision made from a lagging projection is a
 * decision made from possibly stale state.
 *
 * @param deps - Event store and database.
 * @param query - Which upload, and who is asking.
 * @returns The upload as its owner sees it.
 * @throws {NotFoundError} If there is no such upload, it has been deleted, or
 *   it belongs to someone else. All three answer identically: whether another
 *   person's upload exists is not the caller's business.
 */
export async function handleGetUploadById(
  deps: UploadDependencies,
  query: GetUploadByIdQuery,
): Promise<Upload> {
  const { state } = await loadUpload(deps, query.uploadId);

  if (!state.exists || state.status === "deleted" || state.ownerUserId !== query.actorUserId) {
    throw new NotFoundError("No such upload");
  }

  const upload = await readUpload(deps.pool, query.uploadId);

  if (upload === undefined) {
    throw new NotFoundError("No such upload");
  }

  return upload;
}
