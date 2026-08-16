import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * An upload was refused.
 *
 * The reason is shown to the owner, so it describes the media rather than the
 * infrastructure: "that file is larger than the limit" rather than a storage
 * error. Failure is recorded rather than deleting the Upload, because someone
 * whose upload was refused is entitled to know why it did not work.
 *
 * The category decides whether trying again could ever help. A briefly
 * unreachable storage service resolves itself; a 94-second video will be 94
 * seconds long forever, and retrying it burns capacity to reach the same
 * answer. Recording the judgement rather than re-deriving it means a decision
 * to stop retrying is auditable afterwards.
 */
export type UploadFailed = DomainEvent<
  "UploadFailed",
  {
    reason: string;
    /** Whether trying again could ever produce a different answer. */
    category: "transient" | "permanent";
    /** How many attempts had been made when this failure was recorded. */
    attempt: number;
    failedAt: string;
  }
>;
