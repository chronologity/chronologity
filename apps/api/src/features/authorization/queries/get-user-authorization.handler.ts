import type { UserRoles } from "@chronologity/contracts";
import { NotFoundError } from "../../../lib/errors/not-found-error.js";
import { userExists } from "../../users/index.js";
import type { AuthorizationDependencies } from "../dependencies.js";
import { readRoleAssignments } from "../utils/authorization-read-model.js";
import type { GetUserAuthorizationQuery } from "./get-user-authorization.query.js";

/**
 * Read the elevated roles a User holds, with their provenance.
 *
 * Privileged: who holds moderation authority is not public. The route requires
 * `admin:user-role-manage`.
 *
 * @param deps - Database.
 * @param query - Whose roles.
 * @returns The roles held, each with when it was granted and by whom.
 * @throws {NotFoundError} If there is no such account. An account with no
 *   elevated roles returns an empty list, which is a different answer.
 */
export async function handleGetUserAuthorization(
  deps: AuthorizationDependencies,
  query: GetUserAuthorizationQuery,
): Promise<UserRoles> {
  if (!(await userExists(deps.pool, query.userId))) {
    throw new NotFoundError("No such account");
  }

  return {
    userId: query.userId,
    roles: await readRoleAssignments(deps.pool, query.userId),
  };
}
