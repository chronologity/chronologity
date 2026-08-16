import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * An upload was refused.
 *
 * The reason is shown to the owner, so it describes the media rather than the
 * infrastructure: "that file is larger than the limit" rather than a storage
 * error. Failure is recorded rather than deleting the Upload, because someone
 * whose upload was refused is entitled to know why it did not work.
 */
export type UploadFailed = DomainEvent<
  "UploadFailed",
  {
    reason: string;
    failedAt: string;
  }
>;
