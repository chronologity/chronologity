import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProbedMedia } from "../../features/uploads/media-policy.js";
import type { Logger } from "../../lib/logger/logger.js";

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

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  nb_frames?: string;
  duration?: string;
  avg_frame_rate?: string;
}

interface FfprobeOutput {
  format?: { format_name?: string; duration?: string };
  streams?: FfprobeStream[];
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

/**
 * Whether an error means the decoder could not run, rather than would not.
 *
 * @param error - Whatever the child process threw.
 * @returns True for a timeout or a missing binary. Both are faults in the
 *   machinery rather than judgements about a file, so they must not be
 *   mistaken for "this file is not media".
 */
function isTimeoutOrMissing(error: unknown): boolean {
  const code = (error as { code?: string | number } | undefined)?.code;
  const killed = (error as { killed?: boolean } | undefined)?.killed === true;
  const signal = (error as { signal?: string } | undefined)?.signal;

  return killed || signal === "SIGTERM" || code === "ENOENT" || code === "ETIMEDOUT";
}

/**
 * A probe that recognised nothing.
 *
 * @returns An empty result, which the rules read as "this is not media".
 */
function empty(): ProbedMedia {
  return {
    formats: [],
    codec: undefined,
    durationSeconds: undefined,
    width: undefined,
    height: undefined,
    hasAudio: false,
    hasMotion: false,
  };
}

/**
 * Turn the decoder's output into what the rules need.
 *
 * @param stdout - ffprobe's JSON report.
 * @returns What was found. Unparseable output is treated as nothing
 *   recognised rather than as an error, since a decoder that produced
 *   gibberish has told us the same thing as one that produced nothing.
 */
function interpret(stdout: string): ProbedMedia {
  let parsed: FfprobeOutput;

  try {
    parsed = JSON.parse(stdout) as FfprobeOutput;
  } catch {
    return empty();
  }

  const streams = parsed.streams ?? [];
  const visual = streams.find((s) => s.codec_type === "video");

  if (visual === undefined) {
    return empty();
  }

  const formats = (parsed.format?.format_name ?? "").split(",").filter((f) => f.length > 0);
  const duration = toSeconds(parsed.format?.duration ?? visual.duration);

  return {
    formats,
    codec: visual.codec_name,
    durationSeconds: duration,
    width: visual.width,
    height: visual.height,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
    hasMotion: hasMotion(formats, visual, duration),
  };
}

/**
 * Formats that hold a still picture.
 *
 * ffprobe opens images through dedicated demuxers, and which one it chose is
 * the most reliable statement of what kind of file this is.
 */
const IMAGE_FORMATS = new Set([
  "image2",
  "png_pipe",
  "jpeg_pipe",
  "mjpeg",
  "webp_pipe",
  "jpegls_pipe",
  "bmp_pipe",
]);

/**
 * Whether a file actually moves.
 *
 * Not as simple as it sounds, and worth stating why. ffprobe labels a
 * photograph as a `video` stream, so the stream type says nothing. Nor does
 * duration: a single JPEG is reported as lasting 0.04 seconds, because
 * ffprobe assumes 25 frames a second and one frame is a twenty-fifth of a
 * second. An earlier version of this used duration and refused every
 * photograph as a video.
 *
 * What does distinguish them is which demuxer opened the file.
 *
 * @param formats - The container formats reported.
 * @param stream - The visual stream.
 * @param durationSeconds - The file's duration, where known.
 * @returns True if the file has moving pictures in it. A still-image format
 *   never does; anything else does if it holds more than one frame, or lasts
 *   long enough that it must.
 */
function hasMotion(
  formats: readonly string[],
  stream: FfprobeStream,
  durationSeconds: number | undefined,
): boolean {
  if (formats.some((format) => IMAGE_FORMATS.has(format))) {
    return false;
  }

  const frames = stream.nb_frames === undefined ? undefined : Number(stream.nb_frames);

  if (frames !== undefined && Number.isFinite(frames)) {
    return frames > 1;
  }

  return durationSeconds !== undefined && durationSeconds > 0;
}

/**
 * Read a duration reported as a string.
 *
 * @param value - As reported, or undefined.
 * @returns The duration in seconds, or undefined if it was absent or not a
 *   number. ffprobe writes "N/A" for files whose length it cannot establish.
 */
function toSeconds(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const seconds = Number(value);

  return Number.isFinite(seconds) ? seconds : undefined;
}
