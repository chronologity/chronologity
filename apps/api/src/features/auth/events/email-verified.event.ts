import type { DomainEvent } from "../../../types/domain-event.js";

/** Control of a claimed address was proven. */
export type EmailVerified = DomainEvent<
  "EmailVerified",
  { normalizedEmail: string; verifiedAt: string }
>;
