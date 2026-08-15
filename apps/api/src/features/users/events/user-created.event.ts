import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * A User came into existence.
 *
 * Records the Identity it belongs to, because that binding is what makes
 * signing in resolve to this account, and it never changes afterwards. The
 * handle is recorded as chosen; it is presentation, and will change.
 */
export type UserCreated = DomainEvent<
  "UserCreated",
  {
    userId: string;
    identityId: string;
    handle: string;
    normalizedHandle: string;
    displayName: string;
    biography: string | undefined;
    createdAt: string;
  }
>;
