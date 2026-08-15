import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * A User took a new handle.
 *
 * The previous one is recorded so the change is legible in history, and
 * because a handle is not released for reassignment the moment it is given up.
 * This changes nothing about who the User is: identity is the user id, and a
 * handle change breaks no provenance (`identity.md:103`).
 */
export type UserHandleChanged = DomainEvent<
  "UserHandleChanged",
  {
    handle: string;
    normalizedHandle: string;
    previousHandle: string;
    previousNormalizedHandle: string;
    changedAt: string;
  }
>;
