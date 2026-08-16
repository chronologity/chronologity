import type { MediaKind } from "@chronologity/contracts";
import type { DerivativeKind } from "./utils/storage-key.js";

/**
 * Which derivatives a piece of media needs.
 *
 * A pure decision, so what the product produces for each kind of media can be
 * read in one place and tested without a file, a decoder, or a network.
 *
 * Derivatives are for showing media, never for keeping it. The original is
 * always retained and never altered, which is what makes these regenerable —
 * a better thumbnail size, or a format nobody has chosen yet, is a matter of
 * running this again rather than of having lost anything.
 */

/**
 * What to produce for a piece of media.
 *
 * @param kind - What the file actually is, as established by opening it.
 * @returns The derivatives to produce, in the order they should be attempted.
 *   A photograph needs only a preview. A video needs a still frame to show
 *   before it plays, and a repackaged copy that can start playing immediately
 *   — the product expects videos to autoplay, and a video that must download
 *   in full before it begins cannot.
 */
export function derivativesFor(kind: MediaKind): readonly DerivativeKind[] {
  return kind === "video" ? ["poster", "faststart"] : ["thumbnail"];
}

/**
 * Whether an upload has everything it should.
 *
 * Used to decide whether work is already done. The same note arrives twice
 * eventually, and producing a second set of derivatives would cost time and
 * storage to reach a file identical to the one already there.
 *
 * @param kind - What the file actually is.
 * @param produced - Which derivatives already exist.
 * @returns True when nothing further is needed.
 */
export function hasAllDerivatives(kind: MediaKind, produced: readonly DerivativeKind[]): boolean {
  return derivativesFor(kind).every((needed) => produced.includes(needed));
}
