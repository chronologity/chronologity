import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * A Session was observed to have passed its expiry.
 *
 * Recorded when noticed rather than when it happened: expiry is the passage of
 * time, so validity is always evaluated against the clock and never waits for
 * this event to exist.
 */
export type SessionExpired = DomainEvent<"SessionExpired", { expiredAt: string }>;
