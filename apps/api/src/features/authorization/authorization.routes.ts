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
import { errors } from "../../server/error-responses.js";
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

    // Every route this module registers, grouped under one heading in the
    // published document. A hook rather than a line on each route: a route
    // added later is grouped without anybody remembering to say so.
    app.addHook("onRoute", (route) => {
      route.schema = { ...route.schema, tags: ["Authorization"] };
    });

    app.get(
      "/users/me/capabilities",
      {
        schema: {
          summary: "What the caller may do",
          description:
            "The caller's own capabilities, resolved from their roles. Useful for deciding what to show; never for deciding what to allow. Every permission is enforced again server-side on the operation itself.",
          response: { 200: capabilitiesSchema, ...errors(401, 403) },
        },
        preHandler: requireUser,
      },
      async (request) => authorization.capabilitiesFor(request.user.userId),
    );

    app.put(
      "/users/:userId/roles/:role",
      {
        schema: {
          summary: "Grant a role",
          description:
            "Requires `admin:user-role-manage`. Nobody may grant a role to themselves, and every attempt is recorded whether it succeeded or not — a refused self-escalation is exactly what a later review wants to find.",
          params: roleParams,
          body: roleChangeRequestSchema,
          response: { 200: userRolesSchema, ...errors(400, 401, 403, 404) },
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
          // Nullish rather than optional: a request with no body arrives as
          // null, not undefined, so `.optional()` alone refuses the plainest
          // way to call this endpoint — a delete with nothing to say.
          body: roleChangeRequestSchema.nullish(),
          summary: "Remove a role",
          response: { 200: userRolesSchema, ...errors(400, 401, 403, 404) },
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
          summary: "Read somebody's roles",
          params: z.object({ userId: identifierSchema }),
          response: { 200: userRolesSchema, ...errors(401, 403, 404) },
        },
        preHandler: requirePermission("admin:user-role-manage"),
      },
      async (request) => authorization.rolesFor(request.params.userId),
    );
  };
}
