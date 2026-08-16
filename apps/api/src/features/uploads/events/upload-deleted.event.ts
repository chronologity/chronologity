import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * An upload was removed at its owner's request.
 *
 * Records that the removal happened, and nothing about the media itself. The
 * stored object is deleted alongside this, so history keeps the fact of the
 * deletion without keeping what was deleted — which is what makes erasure
 * possible against an append-only stream (ADR-080).
 */
export type UploadDeleted = DomainEvent<
  "UploadDeleted",
  {
    deletedAt: string;
  }
>;
