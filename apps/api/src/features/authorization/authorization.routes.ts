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
import { requirePermission, requireUser } from "../../plugins/auth.plugin.js";
import type { AuthorizationService } from "./authorization.service.js";

const roleParams = z.object({ userId: identifierSchema, role: grantableRoleSchema });

/**
 * Authorization endpoints.
 *
 * Role management is itself privileged (`authorization.md:384-392`), so every
 * route but the capability hint requires `admin:user-role-manage`. The guard
 * refuses before the handler runs, and the service refuses self-escalation
 * again on its own — a route is a convenient place to check and a poor place
 * to rely on.
 *
 * @param authorization - The service these routes delegate to.
 * @returns A Fastify plugin registering the authorization endpoints.
 */
export function authorizationRoutes(authorization: AuthorizationService) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.get(
      "/users/me/capabilities",
      { schema: { response: { 200: capabilitiesSchema } }, preHandler: requireUser },
      async (request) => authorization.capabilitiesFor(request.user.userId),
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
        // already held is that state. The service writes nothing in that case.
        await authorization.assign(
          request.params.userId,
          request.params.role,
          request.user.userId,
          request.body.reason,
          request.requestContext,
        );

        return authorization.rolesFor(request.params.userId);
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
        await authorization.remove(
          request.params.userId,
          request.params.role,
          request.user.userId,
          request.body?.reason,
          request.requestContext,
        );

        return authorization.rolesFor(request.params.userId);
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
      async (request) => authorization.rolesFor(request.params.userId),
    );
  };
}
