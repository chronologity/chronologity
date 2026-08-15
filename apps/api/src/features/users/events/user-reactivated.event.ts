import type { DomainEvent } from "../../../types/domain-event.js";

/** A deactivated User came back. */
export type UserReactivated = DomainEvent<"UserReactivated", { reactivatedAt: string }>;
