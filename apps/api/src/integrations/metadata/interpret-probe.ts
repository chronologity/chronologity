import type { ProbedMedia } from "../../features/uploads/upload.media-policy.js";

/**
 * Reading a decoder's report.
 *
 * Separated from the process that runs the decoder because none of this needs
 * one: it is plain reasoning over a plain object, and it is where the real
 * mistakes live. The first version of `hasMotion` classified every photograph
 * as a video — a bug found only by an integration test needing ffmpeg, real
 * files, and several seconds, when it could have been caught here instantly.
 */

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

/**
 * Whether an error means the decoder could not run, rather than would not.
 *
 * @param error - Whatever the child process threw.
 * @returns True for a timeout or a missing binary. Both are faults in the
 *   machinery rather than judgements about a file, so they must not be
 *   mistaken for "this file is not media".
 */
export function isTimeoutOrMissing(error: unknown): boolean {
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
export function empty(): ProbedMedia {
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
export function interpret(stdout: string): ProbedMedia {
  let parsed: FfprobeOutput;

  try {
    parsed = JSON.parse(stdout) as FfprobeOutput;
  } catch {
    return empty();
  }

  // `JSON.parse("null")` succeeds and returns null, so surviving the parse is
  // not the same as having an object. Reading a field off it crashes the
  // worker on input a decoder could legitimately produce.
  if (typeof parsed !== "object" || parsed === null) {
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
export function hasMotion(
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
export function toSeconds(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  // Trimmed and checked for emptiness first, because `Number("")` is 0 and
  // `Number(" ")` is 0. A duration that could not be established would then
  // read as instantaneous — and an unmeasurable video would sail under the
  // ninety-second limit rather than being refused for having no known length.
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  const seconds = Number(trimmed);

  return Number.isFinite(seconds) ? seconds : undefined;
}
