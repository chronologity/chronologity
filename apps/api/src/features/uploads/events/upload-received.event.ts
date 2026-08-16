import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * The uploaded object arrived and was accepted.
 *
 * Everything here came from storage rather than from the client, which is the
 * point of the transition: a client saying "done" is not evidence
 * (`media.md:236`). The content type is what storage recorded, which the
 * client set at upload time — 5E-2 replaces it with what the bytes actually
 * are.
 */
export type UploadReceived = DomainEvent<
  "UploadReceived",
  {
    byteSize: number;
    contentType: string | undefined;
    /** Storage's checksum. Identifies the bytes; does not authenticate them. */
    checksum: string | undefined;
    receivedAt: string;
  }
>;
