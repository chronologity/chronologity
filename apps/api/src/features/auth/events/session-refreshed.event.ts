import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * A Session's refresh credential was rotated.
 *
 * The generation increments so that replaying a superseded credential is
 * legible in history rather than merely rejected in the moment.
 */
export type SessionRefreshed = DomainEvent<
  "SessionRefreshed",
  { refreshTokenHash: string; refreshGeneration: number; refreshedAt: string }
>;
