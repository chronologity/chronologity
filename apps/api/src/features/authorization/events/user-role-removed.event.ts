import type { GrantableRole } from "@chronologity/contracts";
import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * An elevated role was taken away.
 *
 * A removal is as important to history as a grant: "who stopped being a
 * moderator, when, and at whose hand" is the question asked after something
 * goes wrong.
 */
export type UserRoleRemoved = DomainEvent<
  "UserRoleRemoved",
  {
    userId: string;
    role: GrantableRole;
    removedBy: string | undefined;
    reason: string | undefined;
    removedAt: string;
  }
>;
