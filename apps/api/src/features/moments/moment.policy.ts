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

export type ReorderRejection = "not_a_permutation";

/**
 * Check that a proposed order is a reordering and nothing more.
 *
 * @param proposed - The media identifiers in the order asked for.
 * @param present - The media the Moment currently has.
 * @returns The reason to refuse, or undefined. A reorder that adds or drops
 *   anything is not a reorder: it is an addition or a removal wearing the wrong
 *   name, and each of those has its own rules — that media is ready and owned,
 *   or that at least one remains.
 */
export function checkReorder(
  proposed: readonly string[],
  present: readonly string[],
): ReorderRejection | undefined {
  if (proposed.length !== present.length) {
    return "not_a_permutation";
  }

  const remaining = new Set(present);

  for (const uploadId of proposed) {
    if (!remaining.delete(uploadId)) {
      return "not_a_permutation";
    }
  }

  return undefined;
}

export type RemovalRejection = "not_present" | "last_medium";

/**
 * Check that a piece of media can be taken out.
 *
 * @param uploadId - The medium to remove.
 * @param present - The media the Moment currently has.
 * @returns The reason to refuse, or undefined. Removing the last one is refused
 *   rather than deleting the Moment: media is mandatory, so a Moment without it
 *   could not have been created — and `moments.md:436` is explicit that
 *   deleting a medium is not deleting the Moment. Somebody who wants the Moment
 *   gone deletes the Moment.
 */
export function checkRemoval(
  uploadId: string,
  present: readonly string[],
): RemovalRejection | undefined {
  if (!present.includes(uploadId)) {
    return "not_present";
  }

  if (present.length === 1) {
    return "last_medium";
  }

  return undefined;
}

export type AdditionRejection = "already_present";

/**
 * Check that media being added is not already there.
 *
 * @param uploadIds - The media to add.
 * @param present - The media the Moment currently has.
 * @returns The reason to refuse, or undefined. Adding a file a Moment already
 *   shows would give it two positions in one order, which is the same
 *   incoherence `checkMedia` refuses at creation.
 */
export function checkAddition(
  uploadIds: readonly string[],
  present: readonly string[],
): AdditionRejection | undefined {
  const existing = new Set(present);

  return uploadIds.some((uploadId) => existing.has(uploadId)) ? "already_present" : undefined;
}

/**
 * Say why a reorder was refused.
 *
 * Takes no reason because there is only one: the list was not a permutation.
 * A parameter that can only ever hold one value tells a reader nothing.
 *
 * @returns A message for the person who asked.
 */
export function describeReorderRejection(): string {
  return "A reorder must list exactly the media the moment already has";
}

/**
 * Say why a removal was refused.
 *
 * @param reason - What the check found.
 * @returns A message for the person who asked.
 */
export function describeRemovalRejection(reason: RemovalRejection): string {
  return reason === "not_present"
    ? "That file is not part of this moment"
    : "A moment needs at least one image or video; delete the moment instead";
}

/**
 * Say why an addition was refused.
 *
 * Takes no reason, for the same cause as {@link describeReorderRejection}.
 *
 * @returns A message for the person who asked.
 */
export function describeAdditionRejection(): string {
  return "A moment cannot show the same file twice";
}
