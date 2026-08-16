import type { Capabilities } from "@chronologity/contracts";
import type { AuthorizationDependencies } from "../dependencies.js";
import { effectiveRoles, permissionsFor } from "../policies/role-permissions.js";
import { readRolesFor } from "../utils/authorization-read-model.js";
import type { GetCurrentUserPermissionsQuery } from "./get-current-user-permissions.query.js";

/**
 * Read what the signed-in person may do.
 *
 * A hint for rendering, and nothing more. A client may use it to hide a
 * control nobody can use, which is better than showing a button that fails;
 * but a client that ignores it and calls the endpoint anyway meets the same
 * server-side refusal (`authorization.md:438-444`).
 *
 * @param deps - Database.
 * @param query - Whose capabilities.
 * @returns Their roles, baseline included, and the permissions those roles
 *   confer.
 */
export async function handleGetCurrentUserPermissions(
  deps: AuthorizationDependencies,
  query: GetCurrentUserPermissionsQuery,
): Promise<Capabilities> {
  const roles = effectiveRoles(await readRolesFor(deps.pool, query.userId));

  return {
    userId: query.userId,
    roles: [...roles],
    permissions: [...permissionsFor(roles)],
  };
}
