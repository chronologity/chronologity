import exifReader from "exif-reader";
import type { Coordinates } from "@chronologity/contracts";
import type { StorageClient } from "../storage/storage-client.js";
import type { Logger } from "../../lib/logger/logger.js";
import type { MetadataClient } from "./metadata-client.js";
import { findExifBlock, readCoordinates, readIso6709 } from "./read-embedded-location.js";

/**
 * Asking a file where it was taken.
 *
 * An adapter over two quite different questions that happen to have the same
 * answer. A photograph carries coordinates in a header near the front of the
 * file, so a few kilobytes are enough. A video carries a single tag inside its
 * container, which the decoder already knows how to find.
 *
 * ffprobe cannot read a photograph's coordinates at all — verified rather than
 * assumed — which is why the photograph path parses the header itself instead
 * of asking the decoder that answers every other question about a file.
 *
 * Nothing here is stored. The result is handed to the owner of the upload as
 * something they may accept, and then forgotten.
 */

export interface EmbeddedLocationClient {
  /**
   * Read where a file says it was.
   *
   * @param key - The object to read. Server-generated, never client-supplied.
   * @param kind - Which sort of media it is, established when the file arrived
   *   rather than taken from anything a client declared.
   * @returns Where the file says it was taken, or undefined when it says
   *   nothing. Absence is the ordinary case and not an error: most files carry
   *   no location, either because the camera was told not to record one or
   *   because something stripped it on the way.
   * @throws {Error} If storage could not be reached, or the decoder could not
   *   be run. A file that simply cannot be parsed yields undefined instead —
   *   the question was answered, and the answer is nothing.
   */
  read(key: string, kind: "image" | "video"): Promise<Coordinates | undefined>;
}

/**
 * How much of a photograph to read.
 *
 * The header sits at the front, and 64KB comfortably covers it including an
 * embedded thumbnail. A bound rather than a guess: this runs while somebody
 * waits, and a photograph can be tens of megabytes.
 */
const HEAD_BYTES = 64 * 1024;

/** How long a link to read one object stays valid. Seconds, because that is all it needs. */
const READ_URL_TTL_SECONDS = 60;

/**
 * Build the embedded-location adapter.
 *
 * @param storage - Reads the front of a photograph.
 * @param metadata - Optional. Runs the decoder that reads a video's tag.
 *   Without it a video yields no suggestion; a photograph never needs it.
 * @param logger - Optional. Failures are logged with the reason; the
 *   coordinates are not, since writing them to a log would be storing the one
 *   thing this is careful never to store.
 * @returns A client that can ask a file where it was taken.
 */
export function createEmbeddedLocationClient(
  storage: StorageClient,
  metadata?: MetadataClient,
  logger?: Logger,
): EmbeddedLocationClient {
  return {
    async read(key, kind) {
      if (kind === "video") {
        // A video keeps its location in a container tag, which only a decoder
        // can read. The process serving HTTP has none — it authorises and
        // verifies uploads and never opens one — so a video yields no
        // suggestion there rather than failing. A deployment that adds a
        // decoder gets video for nothing.
        if (metadata === undefined) {
          return undefined;
        }

        const url = await storage.presignDownload(key, READ_URL_TTL_SECONDS);

        return readIso6709(await metadata.probeLocationTag(url));
      }

      const head = await storage.readHead(key, HEAD_BYTES);

      if (head === undefined) {
        return undefined;
      }

      const block = findExifBlock(head);

      if (block === undefined) {
        return undefined;
      }

      try {
        // The parser is pointed at bytes a stranger uploaded, so it is assumed
        // to be capable of throwing on anything malformed. A photograph that
        // defeats it has told us nothing, which is a perfectly good answer and
        // must not become a failed request.
        const parsed = exifReader(Buffer.from(block));

        return readCoordinates(parsed.GPSInfo);
      } catch {
        logger?.debug({ reason: "metadata could not be parsed" }, "No location read from file");

        return undefined;
      }
    },
  };
}
