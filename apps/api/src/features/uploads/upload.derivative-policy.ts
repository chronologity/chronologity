import type { MediaKind } from "@chronologity/contracts";
import type { DerivativeKind } from "./upload.storage-key.js";

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

/**
 * What still needs producing for a piece of media.
 *
 * Producing derivatives is retried, and a retry after a partial failure must
 * add what is missing rather than redo what already exists — re-encoding a
 * video that was transcoded fine costs minutes for nothing.
 *
 * @param kind - What the file actually is, as measured rather than declared.
 * @param existing - What has already been produced and stored.
 * @returns Only the derivatives still absent, in the order they are wanted.
 */
export function missingDerivatives(
  kind: MediaKind,
  existing: readonly DerivativeKind[],
): readonly DerivativeKind[] {
  const have = new Set(existing);

  return derivativesFor(kind).filter((derivative) => !have.has(derivative));
}

/**
 * Everything that exists once a round of production finishes.
 *
 * @param existing - What was already there.
 * @param produced - What this round made.
 * @returns The union, without duplicates. A union rather than a replacement:
 *   a second pass that produced only the missing derivative must not report
 *   that as the complete set and lose the ones made earlier.
 */
export function withProduced(
  existing: readonly DerivativeKind[],
  produced: readonly DerivativeKind[],
): readonly DerivativeKind[] {
  return [...new Set([...existing, ...produced])];
}
