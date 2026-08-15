import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * A Session began.
 *
 * Records the hash of the refresh credential, never the credential. Event
 * history is permanent, and a secret in permanent history cannot be rotated
 * away.
 */
export type SessionCreated = DomainEvent<
  "SessionCreated",
  {
    sessionId: string;
    identityId: string;
    refreshTokenHash: string;
    expiresAt: string;
    createdAt: string;
    clientKind: string | undefined;
  }
>;
