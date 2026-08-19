import type { MediaKind } from "@chronologity/contracts";

/**
 * What makes an uploaded file acceptable.
 *
 * Pure decisions, deliberately. Everything here takes what a decoder found and
 * answers yes or no, so the rules can be tested exhaustively without a file, a
 * network, or a database — and so that reading them tells you the policy
 * rather than the plumbing.
 *
 * The governing idea: what a file *is* comes from opening it. What the
 * uploader said it is only ever a claim to be checked against that.
 */

/** The product's limit on a single video (`media.md:83`). */
export const MAXIMUM_VIDEO_SECONDS = 90;

/**
 * What a decoder reported about a file.
 *
 * Every field is optional because a decoder confronted with something that is
 * not media reports very little, and "it told us almost nothing" is itself an
 * answer worth acting on.
 */
export interface ProbedMedia {
  /** Container formats the decoder recognised, e.g. `mov,mp4,m4a`. */
  readonly formats: readonly string[];
  /** Codec of the first video or image stream, e.g. `h264`, `mjpeg`. */
  readonly codec: string | undefined;
  readonly durationSeconds: number | undefined;
  readonly width: number | undefined;
  readonly height: number | undefined;
  /** Whether the file carries an audio stream. */
  readonly hasAudio: boolean;
  /** Whether any stream moves — the difference between a photo and a video. */
  readonly hasMotion: boolean;
}

export type MediaRejection =
  | "not_media"
  | "kind_mismatch"
  | "unsupported_codec"
  | "no_dimensions"
  | "unknown_duration"
  | "too_long";

export type MediaVerdict =
  | { readonly ok: true; readonly kind: MediaKind; readonly durationSeconds: number | undefined }
  | { readonly ok: false; readonly reason: MediaRejection };

/**
 * Codecs a picture may actually be.
 *
 * An allowlist rather than "whatever decoded", because a decoder is willing to
 * open far more than this product intends to store, and every extra format is
 * more decoder surface exposed to files strangers upload.
 */
const IMAGE_CODECS = new Set(["mjpeg", "png", "webp", "hevc", "av1", "jpeg2000", "bmp"]);

/** Codecs a video may actually be. */
const VIDEO_CODECS = new Set(["h264", "hevc", "vp8", "vp9", "av1", "mpeg4"]);

/**
 * Decide whether a probed file may be stored, and as what.
 *
 * @param probe - What the decoder found.
 * @param declaredKind - What the uploader said it was.
 * @param maximumVideoSeconds - The limit to apply. Passed in rather than read
 *   from the constant so a test can prove the boundary without a 90-second
 *   fixture.
 * @returns The accepted kind and duration, or why it was refused. A video's
 *   duration is returned; an image's is undefined, because a still has none.
 */
export function checkMedia(
  probe: ProbedMedia,
  declaredKind: MediaKind,
  maximumVideoSeconds: number = MAXIMUM_VIDEO_SECONDS,
): MediaVerdict {
  // Nothing recognisable came back. A PDF renamed to .jpg lands here, which is
  // the hole this whole sub-phase exists to close.
  if (probe.formats.length === 0 || probe.codec === undefined) {
    return { ok: false, reason: "not_media" };
  }

  // Motion decides what this is, not the file extension and not the uploader.
  const actualKind: MediaKind = probe.hasMotion ? "video" : "image";

  if (actualKind !== declaredKind) {
    return { ok: false, reason: "kind_mismatch" };
  }

  const permitted = actualKind === "video" ? VIDEO_CODECS : IMAGE_CODECS;

  if (!permitted.has(probe.codec)) {
    return { ok: false, reason: "unsupported_codec" };
  }

  // Every real picture and frame has a size. Its absence means the decoder
  // recognised a container but could not make sense of what was inside.
  if (
    probe.width === undefined ||
    probe.height === undefined ||
    probe.width <= 0 ||
    probe.height <= 0
  ) {
    return { ok: false, reason: "no_dimensions" };
  }

  if (actualKind === "image") {
    return { ok: true, kind: "image", durationSeconds: undefined };
  }

  // A video whose length cannot be determined cannot be checked against the
  // limit, so it is refused rather than admitted unmeasured.
  if (probe.durationSeconds === undefined || !Number.isFinite(probe.durationSeconds)) {
    return { ok: false, reason: "unknown_duration" };
  }

  if (probe.durationSeconds > maximumVideoSeconds) {
    return { ok: false, reason: "too_long" };
  }

  return { ok: true, kind: "video", durationSeconds: probe.durationSeconds };
}

/**
 * What to tell someone whose upload was refused.
 *
 * @param reason - Why it was refused.
 * @param maximumVideoSeconds - Named in the message, because unlike an age
 *   limit this one is public product policy: telling someone their video is
 *   too long is useless without saying what the limit is.
 * @returns A sentence safe to show the upload's owner, describing the file
 *   rather than the machinery that rejected it.
 */
export function describeMediaRejection(
  reason: MediaRejection,
  maximumVideoSeconds: number = MAXIMUM_VIDEO_SECONDS,
): string {
  switch (reason) {
    case "not_media":
      return "That file is not an image or a video";
    case "kind_mismatch":
      return "That file is not the kind of media it was uploaded as";
    case "unsupported_codec":
      return "That media format is not supported";
    case "no_dimensions":
      return "That file could not be read as an image or a video";
    case "unknown_duration":
      return "That video's length could not be determined";
    default:
      return `Videos may be up to ${maximumVideoSeconds} seconds long`;
  }
}

export type FailureCategory = "transient" | "permanent";

/**
 * Whether a failure is worth trying again.
 *
 * The distinction is the whole of the retry policy. Storage being briefly
 * unreachable resolves itself; a 94-second video will be 94 seconds long
 * forever, and retrying it burns capacity to reach the same answer
 * (`media.md:432`).
 *
 * @param reason - Why the media was refused.
 * @returns Always permanent. Every rejection here is a statement about the
 *   file's contents, and its contents do not change. Transient failures come
 *   from the machinery around the check — a failed download, a decoder that
 *   timed out — and are classified where they happen.
 */
export function classifyMediaRejection(reason: MediaRejection): FailureCategory {
  void reason;

  return "permanent";
}

/**
 * Whether an error raised while trying to check a file is worth retrying.
 *
 * @param error - Whatever was thrown while downloading or decoding.
 * @returns Transient for the failures that pass — a network reset, a timeout,
 *   storage briefly refusing. Permanent for anything else, which is the
 *   cautious direction: retrying forever costs capacity and hides the fault,
 *   while giving up early leaves a recorded reason someone can act on.
 */
export function classifyProcessingError(error: unknown): FailureCategory {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string } | undefined)?.code ?? "";

  const transient = [
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "EPIPE",
    "EAI_AGAIN",
    "ENOTFOUND",
    "socket hang up",
    "timed out",
    "Service Unavailable",
    "InternalError",
    "SlowDown",
  ];

  return transient.some(
    (pattern) => code.includes(pattern) || message.toLowerCase().includes(pattern.toLowerCase()),
  )
    ? "transient"
    : "permanent";
}

/**
 * Which media types Chronologity accepts.
 *
 * An allowlist rather than a prefix test. `image/*` would admit SVG, which is
 * a document that executes script rather than a picture, and formats no
 * decoder here supports. Every entry is something the product intends to store
 * and 5E-2 can verify by decoding.
 */
const ACCEPTED: Readonly<Record<string, MediaKind>> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/heic": "image",
  "image/heif": "image",
  "image/avif": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
};

/**
 * Classify a declared content type.
 *
 * A declaration, not a fact: this decides whether an upload is worth
 * authorising at all. What the bytes actually are is established by decoding
 * them, which is 5E-2's work (`media.md:256`).
 *
 * @param contentType - As declared by the client. Parameters such as
 *   `; charset=` are ignored, and matching is case-insensitive, because both
 *   vary between clients without changing the format.
 * @returns The media kind, or undefined if the type is not accepted.
 */
export function inferMediaKind(contentType: string): MediaKind | undefined {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase();

  return normalized === undefined ? undefined : ACCEPTED[normalized];
}

/**
 * The media types a client may declare.
 *
 * @returns Every accepted content type, for error messages and documentation.
 */
export function acceptedContentTypes(): readonly string[] {
  return Object.keys(ACCEPTED);
}
