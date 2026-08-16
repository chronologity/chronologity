import type { MediaKind } from "@chronologity/contracts";
import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * The file was opened, and is what it claimed to be.
 *
 * Everything here came from a decoder rather than from the uploader, which is
 * what makes it worth recording. Until this event, an upload's dimensions and
 * length were claims; after it, they are measurements.
 *
 * This is the point at which media becomes safe to use. Anything that attaches
 * media to a Moment should require it.
 */
export type UploadChecked = DomainEvent<
  "UploadChecked",
  {
    /** What the file actually is, which may differ from what was declared. */
    kind: MediaKind;
    codec: string;
    container: string;
    width: number;
    height: number;
    /** Undefined for a photograph, which has no length. */
    durationSeconds: number | undefined;
    hasAudio: boolean;
    checkedAt: string;
  }
>;
