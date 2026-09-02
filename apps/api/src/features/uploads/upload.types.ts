import type { DerivativeKind, MediaKind } from "@chronologity/contracts";

/** Feature-local types for uploads. */

export type UploadStatus = "registered" | "received" | "ready" | "failed" | "deleted";

/**
 * The stored state a decision is made against.
 *
 * Read from the row rather than replayed, because the row is the authority
 * (ADR-092). Carries only what a transition needs: who owns it, what it
 * claims to be, where the bytes are, what has been produced, and how far
 * through its life it has got.
 */
export interface UploadRecord {
  readonly uploadId: string;
  /** Who registered it. Nobody else may finalize, read, or delete it. */
  readonly ownerUserId: string;
  /** What the uploader said it was. What it actually is comes from decoding it. */
  readonly kind: MediaKind;
  /** Where the bytes were put. Established at registration and never changes. */
  readonly storageKey: string;
  /** What has been produced for showing this media. */
  readonly derivatives: readonly DerivativeKind[];
  readonly status: UploadStatus;
  /** After this instant a registration can no longer be finalized. */
  readonly expiresAt: Date;
}
