import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * An Identity came into existence.
 *
 * Carries no credential and no address: the address arrives as its own fact,
 * so removing one later does not require rewriting the Identity's origin.
 */
export type IdentityCreated = DomainEvent<
  "IdentityCreated",
  { identityId: string; createdAt: string }
>;
