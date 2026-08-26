import type { SearchSuggestion, SuggestionMatch } from "@chronologity/contracts";

/**
 * Completing a name somebody is still typing.
 *
 * Pure. The decisions here are all about how little to say: how short a prefix
 * is too short to answer, which of an Event's several names to show, and what a
 * suggestion is allowed to carry.
 *
 * `search.md:527` gives the rule this exists to respect — a private entity name
 * must not leak because somebody typed a matching prefix. Nothing in this file
 * decides eligibility; that is the query's job, using the same predicate search
 * uses. What this file does is make sure that once something is eligible, the
 * shape returned discloses nothing beyond a name.
 */

/**
 * How much must be typed before anything is offered.
 *
 * Two characters. Answering a single letter turns autocomplete into a listing
 * of everything the asker may see, twenty-six requests wide — which is the
 * enumeration this surface is most exposed to.
 */
export const MINIMUM_PREFIX = 2;

/** The longest prefix considered. Anything beyond is noise. */
const MAXIMUM_PREFIX = 100;

/** A prefix worth answering. */
export interface InterpretedPrefix {
  readonly prefix: string;
  readonly limit: number;
}

/**
 * Read what has been typed.
 *
 * @param raw - The characters so far.
 * @param limit - How many suggestions were asked for.
 * @returns The prefix to match on, or undefined when there is not enough to go
 *   on. Undefined means an empty list rather than an error: a box somebody is
 *   still typing into has not done anything wrong.
 */
export function interpretPrefix(raw: string, limit: number): InterpretedPrefix | undefined {
  const prefix = raw.trim().toLowerCase().slice(0, MAXIMUM_PREFIX);

  return prefix.length < MINIMUM_PREFIX ? undefined : { prefix, limit };
}

/** The names a candidate goes by. */
export interface NamedCandidate {
  readonly entityType: string;
  readonly entityId: string;
  readonly title: string;
  /** Space-separated, as the index stores them. */
  readonly aliases: string;
}

/**
 * Decide which of a thing's names to show.
 *
 * An Event recorded as "The First World War" and also known as "The Great War"
 * should suggest whichever the person is typing — and say so. Showing the title
 * when they typed an alias looks like a different Event; showing the alias
 * without the title looks like an Event they have never heard of.
 *
 * @param candidate - The thing and its names.
 * @param prefix - What has been typed, lowercased.
 * @returns What to show, which name matched, and the title where an alias won.
 *   Falls back to the title when neither name starts with the prefix, which
 *   happens on a fuzzy match — the store found it by similarity, so the closest
 *   honest answer is what the thing is called.
 */
export function chooseName(candidate: NamedCandidate, prefix: string): SearchSuggestion {
  const base = {
    entityType: candidate.entityType as SearchSuggestion["entityType"],
    entityId: candidate.entityId,
  };

  if (candidate.title.toLowerCase().startsWith(prefix)) {
    return { ...base, label: candidate.title, matchedOn: "title" as SuggestionMatch };
  }

  // The first alias that matches, by position rather than by length, so the
  // same prefix against the same thing always suggests the same name.
  const alias = candidate.aliases
    .split(" ")
    .find((name) => name.length > 0 && name.toLowerCase().startsWith(prefix));

  if (alias !== undefined) {
    return {
      ...base,
      label: alias,
      matchedOn: "alias" as SuggestionMatch,
      title: candidate.title,
    };
  }

  return { ...base, label: candidate.title, matchedOn: "title" as SuggestionMatch };
}

/**
 * Which name to offer when nothing matched at all.
 *
 * @param resultCount - How many results the search actually found.
 * @param candidates - The nearest eligible titles, in order of closeness. Drawn
 *   from the same eligible set as results and after eligibility, which is what
 *   keeps a correction from naming something the asker could not have found.
 * @returns The nearest name, or undefined. Undefined whenever anything matched
 *   — a correction alongside results would suggest the results were wrong — and
 *   undefined when nothing close exists, because a correction nobody can act on
 *   is noise and inventing one would be fabricating history.
 */
export function correctionFor(
  resultCount: number,
  candidates: readonly string[],
): string | undefined {
  if (resultCount > 0) {
    return undefined;
  }

  const nearest = candidates[0];

  return nearest === undefined || nearest.length === 0 ? undefined : nearest;
}
