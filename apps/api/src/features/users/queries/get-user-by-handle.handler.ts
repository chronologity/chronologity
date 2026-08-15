import type { PublicUser } from "@chronologity/contracts";
import { NotFoundError } from "../../../lib/errors/not-found-error.js";
import type { UserDependencies } from "../dependencies.js";
import { normalizeHandle } from "../handle-policy.js";
import { findUserByHandle } from "../utils/handle-store.js";
import { readPublicUser } from "../utils/user-read-model.js";
import { withTransaction } from "../../../lib/database/transaction.js";
import type { GetUserByHandleQuery } from "./get-user-by-handle.query.js";

/**
 * Read a public profile by handle.
 *
 * Released handles do not resolve, so a former handle never quietly points at
 * whoever used to hold it.
 *
 * @param deps - Database.
 * @param query - The handle, in any casing.
 * @returns The public view of that User.
 * @throws {NotFoundError} If nobody currently holds the handle, or the account
 *   is deactivated. Both read as absent: which one it is tells a stranger more
 *   than they need to know.
 */
export async function handleGetUserByHandle(
  deps: UserDependencies,
  query: GetUserByHandleQuery,
): Promise<PublicUser> {
  const userId = await withTransaction(deps.pool, (tx) =>
    findUserByHandle(tx, normalizeHandle(query.handle)),
  );

  const user = userId === undefined ? undefined : await readPublicUser(deps.pool, userId);

  if (user === undefined) {
    throw new NotFoundError("No such account");
  }

  return user;
}
