/**
 * The Authorization feature's public surface.
 *
 * Everything else is internal. The server needs the routes; the auth plugin
 * needs to read current roles and decide; the CLI needs the commands that
 * grant the first administrator.
 *
 * This feature owns the platform-wide role and permission foundation. It does
 * not own resource rules — Moment visibility, blocking, Location precision —
 * which stay close to the features that own those resources
 * (`authorization.md:418-422`).
 */
export { authorizationRoutes } from "./routes/authorization.routes.js";
export { assignUserRole } from "./commands/assign-user-role.command.js";
export { handleAssignUserRole } from "./commands/assign-user-role.handler.js";
export { removeUserRole } from "./commands/remove-user-role.command.js";
export { handleRemoveUserRole } from "./commands/remove-user-role.handler.js";
export { hasPermission } from "./policies/authorization-policy.js";
export { effectiveRoles, permissionsFor } from "./policies/role-permissions.js";
export { readRolesFor } from "./utils/authorization-read-model.js";
export type { AuthorizationDependencies } from "./dependencies.js";
