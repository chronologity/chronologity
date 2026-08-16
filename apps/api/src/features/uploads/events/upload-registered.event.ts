import type { MediaKind } from "@chronologity/contracts";
import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * An upload was authorised.
 *
 * The declared content type and size are what the client said it would send.
 * They are recorded as claims rather than facts, and history keeps them so
 * that a later mismatch between claim and object is answerable.
 *
 * The storage key is here because it is generated at this moment and must not
 * be recomputed later: it is the only pointer to the bytes, and a rule that
 * derives it would silently orphan objects the day the rule changes.
 */
export type UploadRegistered = DomainEvent<
  "UploadRegistered",
  {
    uploadId: string;
    ownerUserId: string;
    kind: MediaKind;
    declaredContentType: string;
    declaredByteSize: number;
    storageKey: string;
    registeredAt: string;
    expiresAt: string;
  }
>;
