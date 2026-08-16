import type { MediaKind } from "@chronologity/contracts";

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
