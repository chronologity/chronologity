import {
  capabilitiesSchema,
  roleChangeRequestSchema,
  userRolesSchema,
} from "@chronologity/contracts";
import { defineOperation } from "./operation.js";

/**
 * Platform roles, and what they permit.
 *
 * **Roles never live in a token.** They are read from the authoritative store on
 * every request, so revoking one takes effect immediately rather than when
 * somebody's token expires. A client may read its own capabilities to decide
 * what to show — and that is all it may decide: `monorepo.md:604` is explicit
 * that a client's checks control presentation, never access.
 */

/** What this account is permitted to do. For deciding what to show, never what to allow. */
export const getCapabilities = defineOperation({
  method: "GET",
  template: "/users/me/capabilities",
  response: capabilitiesSchema,
});

/** Every role held by one account. */
export const getUserRoles = defineOperation({
  method: "GET",
  template: "/users/:userId/roles",
  path: (args: { params: { userId: string } }) => `/users/${args.params.userId}/roles`,
  response: userRolesSchema,
});

/** Grant a role. Privileged, and recorded as an audited action. */
export const grantRole = defineOperation({
  method: "PUT",
  template: "/users/:userId/roles/:role",
  path: (args: { params: { userId: string; role: string } }) =>
    `/users/${args.params.userId}/roles/${args.params.role}`,
  body: roleChangeRequestSchema,
  response: userRolesSchema,
});

/** Take a role away. */
export const revokeRole = defineOperation({
  method: "DELETE",
  template: "/users/:userId/roles/:role",
  path: (args: { params: { userId: string; role: string } }) =>
    `/users/${args.params.userId}/roles/${args.params.role}`,
  body: roleChangeRequestSchema.nullish(),
  response: userRolesSchema,
});
