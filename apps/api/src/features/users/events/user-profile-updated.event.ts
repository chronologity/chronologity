import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * Someone changed how they present themselves.
 *
 * Only the fields that changed appear. A biography set to null was cleared,
 * which is different from one that was left alone.
 */
export type UserProfileUpdated = DomainEvent<
  "UserProfileUpdated",
  {
    displayName: string | undefined;
    biography: string | null | undefined;
    updatedAt: string;
  }
>;
