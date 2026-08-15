import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * A Session was ended deliberately.
 *
 * The reason is part of the record: a logout and a suspected credential theft
 * end the same way but mean different things afterwards.
 */
export type SessionRevoked = DomainEvent<"SessionRevoked", { reason: string; revokedAt: string }>;
