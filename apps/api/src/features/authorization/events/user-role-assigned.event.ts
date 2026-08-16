import type { GrantableRole } from "@chronologity/contracts";
import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * A User was granted an elevated role.
 *
 * Records who granted it, because a privilege that cannot be traced to whoever
 * conferred it is not auditable. The actor is absent for a grant made through
 * the CLI, where authority came from infrastructure access rather than from an
 * acting User; the reason says so.
 */
export type UserRoleAssigned = DomainEvent<
  "UserRoleAssigned",
  {
    userId: string;
    role: GrantableRole;
    assignedBy: string | undefined;
    reason: string | undefined;
    assignedAt: string;
  }
>;
