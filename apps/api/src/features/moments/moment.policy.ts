import type { Occurrence } from "@chronologity/contracts";

/**
 * The rules a Moment has to satisfy.
 *
 * Pure functions, so they need no database and can be exercised exhaustively.
 *
 * What is deliberately absent is any rule about occurrence times in the future.
 * `moments.md:247` says a future plan is "not *automatically* a Moment", which
 * is softer than a prohibition, and refusing one would answer by implementation
 * a question the document left open — while turning a phone with a fast clock
 * into a failed request.
 */

export type OccurrenceRejection = "interval_reversed" | "instant_not_a_point";

export type MediaRejection = "no_media" | "duplicate_media";

/**
 * Check that an occurrence's interval and its precision agree.
 *
 * Identical in shape to the rule real-world Events apply, because both describe
 * the same thing: a bounded stretch of time known to some granularity.
 *
 * @param occurrence - The interval and the precision claimed for it.
 * @returns The reason to refuse, or undefined when the two agree.
 */
export function checkOccurrence(occurrence: Occurrence): OccurrenceRejection | undefined {
  const start = Date.parse(occurrence.start);
  const end = Date.parse(occurrence.end);

  if (end < start) {
    return "interval_reversed";
  }

  // An instant is a point in time. Given two different ends it is not an
  // instant, and storing it as one would claim a precision nobody has.
  if (occurrence.precision === "instant" && end !== start) {
    return "instant_not_a_point";
  }

  return undefined;
}

/**
 * Check the media a Moment is being built from.
 *
 * @param uploadIds - The media, in the order it should be shown.
 * @returns The reason to refuse, or undefined. A Moment needs at least one
 *   piece of media, and must not name the same one twice — the second is
 *   incoherent rather than merely redundant, since one file cannot occupy two
 *   positions in one order.
 */
export function checkMedia(uploadIds: readonly string[]): MediaRejection | undefined {
  if (uploadIds.length === 0) {
    return "no_media";
  }

  if (new Set(uploadIds).size !== uploadIds.length) {
    return "duplicate_media";
  }

  return undefined;
}

/**
 * Say why an occurrence was refused.
 *
 * @param reason - What the check found.
 * @returns A message for the person who asked.
 */
export function describeOccurrenceRejection(reason: OccurrenceRejection): string {
  return reason === "interval_reversed"
    ? "An occurrence cannot end before it starts"
    : "An occurrence known to the instant must start and end at the same moment";
}

/**
 * Say why the media was refused.
 *
 * @param reason - What the check found.
 * @returns A message for the person who asked.
 */
export function describeMediaRejection(reason: MediaRejection): string {
  return reason === "no_media"
    ? "A moment needs at least one image or video"
    : "A moment cannot show the same file twice";
}

/**
 * Place each piece of media in the order it was given.
 *
 * @param uploadIds - The media, already checked for duplicates.
 * @returns Each identifier with its position, dense and zero-based. Dense
 *   because a gap would be a position nothing occupies, and the order is meant
 *   to be read as a sequence rather than as a set of sort keys.
 */
export function positionMedia(
  uploadIds: readonly string[],
): { uploadId: string; position: number }[] {
  return uploadIds.map((uploadId, position) => ({ uploadId, position }));
}
