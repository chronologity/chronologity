import {
  capabilitiesSchema,
  grantableRoleSchema,
  identifierSchema,
  roleChangeRequestSchema,
  userRolesSchema,
} from "@chronologity/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requirePermission, requireUser } from "../../../plugins/auth.plugin.js";
import { assignUserRole } from "../commands/assign-user-role.command.js";
import { handleAssignUserRole } from "../commands/assign-user-role.handler.js";
import { removeUserRole } from "../commands/remove-user-role.command.js";
import { handleRemoveUserRole } from "../commands/remove-user-role.handler.js";
import type { AuthorizationDependencies } from "../dependencies.js";
import { handleGetCurrentUserPermissions } from "../queries/get-current-user-permissions.handler.js";
import { handleGetUserAuthorization } from "../queries/get-user-authorization.handler.js";

const roleParams = z.object({ userId: identifierSchema, role: grantableRoleSchema });

/**
 * Authorization endpoints.
 *
 * Role management is itself privileged (`authorization.md:384-392`), so every
 * route but the capability hint requires `admin:user-role-manage`. The guard
 * refuses before the handler runs, and the handler refuses self-escalation
 * again on its own — a route is a convenient place to check and a poor place
 * to rely on.
 *
 * @param deps - What the authorization handlers need.
 * @returns A Fastify plugin registering the authorization endpoints.
 */
export function authorizationRoutes(deps: AuthorizationDependencies) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.get(
      "/users/me/capabilities",
      { schema: { response: { 200: capabilitiesSchema } }, preHandler: requireUser },
      async (request) => handleGetCurrentUserPermissions(deps, { userId: request.user.userId }),
    );

    app.put(
      "/users/:userId/roles/:role",
      {
        schema: {
          params: roleParams,
          body: roleChangeRequestSchema,
          response: { 200: userRolesSchema },
        },
        preHandler: requirePermission("admin:user-role-manage"),
      },
      async (request) => {
        // Idempotent by design: PUT declares a desired state, and a role
        // already held is that state. The handler writes nothing in that case.
        await handleAssignUserRole(
          deps,
          assignUserRole(
            request.params.userId,
            request.params.role,
            request.user.userId,
            request.body.reason,
          ),
          request.requestContext,
        );

        return handleGetUserAuthorization(deps, { userId: request.params.userId });
      },
    );

    app.delete(
      "/users/:userId/roles/:role",
      {
        schema: {
          params: roleParams,
          body: roleChangeRequestSchema.optional(),
          response: { 200: userRolesSchema },
        },
        preHandler: requirePermission("admin:user-role-manage"),
      },
      async (request) => {
        await handleRemoveUserRole(
          deps,
          removeUserRole(
            request.params.userId,
            request.params.role,
            request.user.userId,
            request.body?.reason,
          ),
          request.requestContext,
        );

        return handleGetUserAuthorization(deps, { userId: request.params.userId });
      },
    );

    app.get(
      "/users/:userId/roles",
      {
        schema: {
          params: z.object({ userId: identifierSchema }),
          response: { 200: userRolesSchema },
        },
        preHandler: requirePermission("admin:user-role-manage"),
      },
      async (request) => handleGetUserAuthorization(deps, { userId: request.params.userId }),
    );
  };
}
