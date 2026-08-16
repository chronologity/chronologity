import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { Logger } from "../../lib/logger/logger.js";

const run = promisify(execFile);

/**
 * Producing the files that make media showable.
 *
 * An adapter, like the probe beside it: it transforms bytes and decides
 * nothing about whether it should have. What derivatives a given upload needs
 * is decided in `features/uploads/derivative-policy.ts`.
 *
 * Everything here reads the original over the network and writes its output to
 * a temporary file, because these tools produce files rather than streams. The
 * temporary file is always removed, including when the work fails.
 *
 * Reading over the network was verified before this was written, including the
 * awkward case: repackaging a video whose playback information sits at the end
 * of the file, which is what a phone typically produces.
 */

export interface DerivativeConfig {
  /** Where ffmpeg lives. On PATH by default. */
  readonly ffmpegPath?: string;
  /**
   * How long any one derivative may take.
   *
   * A bound rather than a guess. This work happens on a queue, and a file that
   * sends the encoder hunting must not hold up everything behind it.
   */
  readonly timeoutMs?: number;
  /** How wide a thumbnail should be. Height follows the original's shape. */
  readonly thumbnailWidth?: number;
  /** How wide a video's still frame should be. */
  readonly posterWidth?: number;
}

export interface DerivativeClient {
  /**
   * Shrink a photograph to a preview.
   *
   * @param url - A temporary link permitting reads of the original.
   * @returns The preview image's bytes.
   * @throws {Error} If the image could not be read or scaled.
   */
  thumbnail(url: string): Promise<Uint8Array>;
  /**
   * Take a still frame from a video.
   *
   * @param url - A temporary link permitting reads of the original.
   * @returns The frame's bytes, as an image.
   * @throws {Error} If no frame could be extracted.
   */
  poster(url: string): Promise<Uint8Array>;
  /**
   * Repackage a video so a player can begin immediately.
   *
   * @param url - A temporary link permitting reads of the original.
   * @returns The repackaged video's bytes.
   * @throws {Error} If the video could not be repackaged.
   */
  faststart(url: string): Promise<Uint8Array>;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_THUMBNAIL_WIDTH = 480;
const DEFAULT_POSTER_WIDTH = 1_280;

/**
 * Build the derivative-producing adapter.
 *
 * @param config - Where ffmpeg is, how long it may take, and how large the
 *   images should be.
 * @param logger - Optional. Failures are logged with the reason; the URL is
 *   not, since it carries a signature granting read access.
 * @returns A client that can produce each derivative.
 */
export function createDerivativeClient(
  config: DerivativeConfig = {},
  logger?: Logger,
): DerivativeClient {
  const binary = config.ffmpegPath ?? "ffmpeg";
  const timeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const thumbnailWidth = config.thumbnailWidth ?? DEFAULT_THUMBNAIL_WIDTH;
  const posterWidth = config.posterWidth ?? DEFAULT_POSTER_WIDTH;

  /**
   * Run ffmpeg into a temporary file and hand back what it wrote.
   *
   * @param suffix - The output file's extension, which tells ffmpeg the format.
   * @param args - Arguments describing the transformation, without the output.
   * @returns The bytes ffmpeg produced.
   * @throws {Error} If ffmpeg failed, or produced nothing.
   */
  const produce = async (suffix: string, args: readonly string[]): Promise<Uint8Array> => {
    // A fresh name each time, so two derivatives being produced at once cannot
    // read each other's half-written output.
    const output = join(tmpdir(), `chronologity-${randomUUID()}${suffix}`);

    try {
      await run(binary, [...args, "-y", output], { timeout });

      const bytes = await readFile(output);

      // ffmpeg can exit successfully having written nothing, given input it
      // could describe but not decode. An empty derivative is a failure that
      // would otherwise be stored and served.
      if (bytes.byteLength === 0) {
        throw new Error("produced an empty file");
      }

      return bytes;
    } finally {
      // Always, including when the work failed. A worker that leaks temporary
      // files fills its disk and takes everything else with it — which is
      // exactly how this project lost a day to a full disk once already.
      await rm(output, { force: true }).catch(() => {
        logger?.warn({ output }, "Could not remove a temporary file");
      });
    }
  };

  return {
    async thumbnail(url) {
      return produce(".jpg", [
        "-v",
        "error",
        "-i",
        url,
        // Width fixed, height following the original's shape. `-2` keeps the
        // height even, which some encoders require.
        "-vf",
        `scale=${thumbnailWidth}:-2`,
        "-frames:v",
        "1",
      ]);
    },

    async poster(url) {
      return produce(".jpg", [
        "-v",
        "error",
        "-i",
        url,
        // The first frame. Choosing a more representative one means decoding
        // further into the file for a judgement nobody has defined; the first
        // frame is honest and cheap.
        "-frames:v",
        "1",
        "-vf",
        `scale=${posterWidth}:-2`,
      ]);
    },

    async faststart(url) {
      return produce(".mp4", [
        "-v",
        "error",
        "-i",
        url,
        // No re-encoding. The video is repackaged so its playback information
        // sits at the front, which is what lets a player begin before the file
        // has finished downloading. Re-encoding would cost quality and time
        // for no benefit.
        "-c",
        "copy",
        "-movflags",
        "+faststart",
      ]);
    },
  };
}
