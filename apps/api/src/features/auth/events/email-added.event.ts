import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * An address was claimed by an Identity.
 *
 * Both forms are recorded: the address as the person wrote it, and the
 * normalized form used for resolution. Keeping only the normalized form would
 * discard how someone chose to present their own address.
 */
export type EmailAdded = DomainEvent<"EmailAdded", { email: string; normalizedEmail: string }>;
