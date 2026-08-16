import type { MediaKind } from "@chronologity/contracts";
import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * The uploaded object arrived and was accepted.
 *
 * The measured facts came from storage rather than from the client, which is
 * the point of the transition: a client saying "done" is not evidence
 * (`media.md:236`). The content type is what storage recorded, which the
 * client set at upload time — 5E-2 replaces it with what the bytes actually
 * are.
 *
 * The identifying fields repeat what registration established. An event that
 * cannot be read on its own is not much of a record: anything consuming this
 * would otherwise have to replay the stream to learn which upload it concerns
 * and where the bytes live.
 */
export type UploadReceived = DomainEvent<
  "UploadReceived",
  {
    uploadId: string;
    ownerUserId: string;
    /** As declared at registration. What the bytes really are is 5E-2's work. */
    kind: MediaKind;
    storageKey: string;
    byteSize: number;
    contentType: string | undefined;
    /** Storage's checksum. Identifies the bytes; does not authenticate them. */
    checksum: string | undefined;
    receivedAt: string;
  }
>;
