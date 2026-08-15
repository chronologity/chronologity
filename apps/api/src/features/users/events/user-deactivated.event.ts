import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * A User deactivated their own account.
 *
 * Distinct from suspension, which is an enforcement decision made by someone
 * else and belongs to moderation, and from deletion, which removes rather than
 * suspends. Deactivation is reversible by the person who chose it.
 */
export type UserDeactivated = DomainEvent<"UserDeactivated", { deactivatedAt: string }>;
