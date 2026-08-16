import { z } from "zod";
import { identifierSchema } from "./identifiers.js";
import { timestampSchema } from "./time.js";

/**
 * Authorization boundary contracts.
 *
 * Roles and permission identifiers cross runtime boundaries — the mobile
 * client renders from capability hints, and the feed aggregator will check
 * permissions of its own — so their spelling is canonical here
 * (`authorization.md:424-436`). Which role grants which permission is an
 * internal decision and stays server-side.
 */

/**
 * The platform roles.
 *
 * `user` is every account's baseline and is never stored: it is what being a
 * User means. `moderator` and `administrator` are granted explicitly.
 *
 * Deliberately three. The architecture warns against role proliferation and
 * says to introduce a role only when a concrete responsibility requires one; a
 * support or security role would today be a name with no capabilities behind
 * it.
 */
export const roleSchema = z.enum(["user", "moderator", "administrator"]);

export type Role = z.infer<typeof roleSchema>;

/** The roles that can be granted and removed. `user` is not one of them. */
export const grantableRoleSchema = z.enum(["moderator", "administrator"]);

export type GrantableRole = z.infer<typeof grantableRoleSchema>;

/**
 * Every permission the platform recognises.
 *
 * One registry so that an identifier has one spelling and one meaning. It
 * holds only permissions something actually enforces: registering
 * `moment:create` before Moments exist would invent an identifier that the
 * phase implementing them would want to change, and a registry prevents drift
 * whether it has one entry or forty. Each phase adds its own.
 */
export const PERMISSIONS = ["admin:user-role-manage"] as const;

export const permissionSchema = z.enum(PERMISSIONS);

export type Permission = z.infer<typeof permissionSchema>;

/**
 * What a Viewer may do, as the client understands it.
 *
 * Presentation only. A client may hide a control it has no permission for, and
 * that improves usability, but the server decides. A client that ignores this
 * entirely and calls the endpoint anyway gets the same refusal.
 */
export const capabilitiesSchema = z.object({
  userId: identifierSchema,
  roles: z.array(roleSchema),
  permissions: z.array(permissionSchema),
});

export type Capabilities = z.infer<typeof capabilitiesSchema>;

/** A role held by a User, and when it was granted. */
export const roleAssignmentSchema = z.object({
  role: grantableRoleSchema,
  assignedAt: timestampSchema,
  /** Absent when granted through the CLI, where no User was acting. */
  assignedBy: identifierSchema.nullable(),
});

export type RoleAssignment = z.infer<typeof roleAssignmentSchema>;

/** The elevated roles a User holds. */
export const userRolesSchema = z.object({
  userId: identifierSchema,
  roles: z.array(roleAssignmentSchema),
});

export type UserRoles = z.infer<typeof userRolesSchema>;

/**
 * Granting or removing a role.
 *
 * A reason is optional but recorded, because "who did this" is rarely the
 * whole question an audit trail is asked.
 */
export const roleChangeRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

export type RoleChangeRequest = z.infer<typeof roleChangeRequestSchema>;
