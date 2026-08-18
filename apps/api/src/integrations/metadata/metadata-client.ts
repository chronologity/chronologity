import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProbedMedia } from "../../features/uploads/media-policy.js";
import type { Logger } from "../../lib/logger/logger.js";
import { empty, interpret, isTimeoutOrMissing } from "./interpret-probe.js";

const run = promisify(execFile);

/**
 * Reading what a media file actually is.
 *
 * An adapter, not a judge: it opens a file and reports what it found, and has
 * no opinion about whether that is acceptable. The rules live in
 * `features/uploads/media-policy.ts`.
 *
 * ffprobe is a system dependency rather than a bundled package. The decoder is
 * pointed at files that strangers upload, which makes it one of the more
 * exposed pieces of the system — so it should be a version the operating
 * system keeps patched, not one frozen inside a dependency tree.
 *
 * What the decoder's report *means* lives next door in `interpret-probe.ts`,
 * which needs no decoder and is unit tested. This file is only the part that
 * has to start a process.
 *
 * It reads over the network. A file's descriptive header is a small part of
 * it, so the decoder asks storage for the ranges it needs rather than pulling
 * down hundreds of megabytes. Verified against SeaweedFS for files whose
 * header sits at the front and at the end, both of which occur in practice
 * depending on what recorded the video.
 */

export interface MetadataClient {
  /**
   * Open a file and report what it is.
   *
   * @param url - A temporary link permitting reads of the object.
   * @returns What the decoder found.
   * @throws {Error} If the decoder could not be run at all, or exceeded its
   *   time limit. A file that is simply not media does not throw: it comes
   *   back as a probe with nothing recognised, which is an answer.
   */
  probe(url: string): Promise<ProbedMedia>;
}

export interface MetadataConfig {
  /** Where ffprobe lives. On PATH by default. */
  readonly ffprobePath?: string;
  /**
   * How long the decoder may take.
   *
   * A bound rather than a guess: a malformed file can send a decoder hunting
   * through an entire object, and this work happens on a queue where one slow
   * file must not stall everything behind it.
   */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Build the media-probing adapter.
 *
 * @param config - Where the decoder is and how long it may take.
 * @param logger - Optional. Probe failures are logged with the reason; the URL
 *   is not, since it carries a signature that grants read access.
 * @returns A client that can report what a file is.
 */
export function createMetadataClient(config: MetadataConfig = {}, logger?: Logger): MetadataClient {
  const binary = config.ffprobePath ?? "ffprobe";
  const timeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async probe(url) {
      let stdout: string;

      try {
        const result = await run(
          binary,
          [
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_entries",
            "format=format_name,duration:stream=codec_type,codec_name,width,height,nb_frames,duration,avg_frame_rate",
            url,
          ],
          { timeout, maxBuffer: 1024 * 1024 },
        );

        stdout = result.stdout;
      } catch (error) {
        // A non-zero exit means the decoder refused the file, which is an
        // answer rather than a fault: it is what "this is not media" looks
        // like. A timeout or a missing binary is a real failure and is
        // rethrown, so the caller can decide whether retrying makes sense.
        if (isTimeoutOrMissing(error)) {
          throw error;
        }

        logger?.debug({ reason: "probe rejected the file" }, "Media probe found nothing");

        return empty();
      }

      return interpret(stdout);
    },
  };
}
