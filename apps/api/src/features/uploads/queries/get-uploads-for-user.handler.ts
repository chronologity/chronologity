import type { UploadList } from "@chronologity/contracts";
import type { UploadDependencies } from "../dependencies.js";
import { readUploadsForUser } from "../utils/upload-read-model.js";
import type { GetUploadsForUserQuery } from "./get-uploads-for-user.query.js";

/**
 * Read someone's own uploads.
 *
 * Scoped to the caller by construction: the query carries the owner, and the
 * route supplies it from the authenticated session rather than from anything
 * the client sent. There is no way to ask this for another person's uploads.
 *
 * @param deps - Database.
 * @param query - Whose uploads.
 * @returns Their uploads, newest first, excluding deleted ones.
 */
export async function handleGetUploadsForUser(
  deps: UploadDependencies,
  query: GetUploadsForUserQuery,
): Promise<UploadList> {
  return { uploads: await readUploadsForUser(deps.pool, query.ownerUserId) };
}
