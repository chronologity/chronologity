/**
 * Keeping one voice from filling a page.
 *
 * Pure. `discovery.md:626` asks that Discovery avoid collapsing exploration
 * around the most prominent creators, places, and Events — and warns in the
 * same breath that diversity should improve historical breadth rather than
 * "operate as an unexplained randomization mechanism". So this is a cap rather
 * than a shuffle: the order that ranking produced survives, and what changes is
 * how much of it any one author, place, or Event is allowed to occupy.
 *
 * Applied after ranking and before the page is cut, so the cap decides what is
 * offered rather than thinning what was already chosen. Capping afterwards
 * would return short pages and leak the same way post-filtering does.
 */

/** What a candidate belongs to. */
export interface Facets {
  readonly authorUserId: string;
  readonly locationId: string | undefined;
  readonly realWorldEventId: string | undefined;
}

/** How much of a page any one thing may occupy. */
export interface DiversityCaps {
  readonly perAuthor: number;
  readonly perLocation: number;
  readonly perRealWorldEvent: number;
}

/**
 * Sensible defaults for a page of twenty.
 *
 * Deliberately not one each. A person who recorded a wedding from six angles
 * has six Moments that belong together, and a cap of one would make Discovery
 * incoherent in the name of breadth. Three is enough to show a perspective
 * without letting it become the page.
 */
export const DEFAULT_CAPS: DiversityCaps = {
  perAuthor: 3,
  perLocation: 3,
  perRealWorldEvent: 4,
};

/**
 * Take the best of an ordered list without letting anything dominate it.
 *
 * @param candidates - Ranked, best first, each with what it belongs to.
 * @param limit - How many to return at most.
 * @param caps - How much of the page each facet may occupy.
 * @returns The survivors, in the order they arrived. A candidate with no place
 *   or no Event is capped by its author alone — the absence of a facet is not a
 *   free pass, but neither is it a reason to exclude, and Moments without a
 *   recorded place are ordinary rather than exceptional.
 */
export function capPerFacet<Candidate extends Facets>(
  candidates: readonly Candidate[],
  limit: number,
  caps: DiversityCaps = DEFAULT_CAPS,
): Candidate[] {
  const byAuthor = new Map<string, number>();
  const byLocation = new Map<string, number>();
  const byEvent = new Map<string, number>();
  const kept: Candidate[] = [];

  for (const candidate of candidates) {
    if (kept.length >= limit) {
      break;
    }

    if (
      atCap(byAuthor, candidate.authorUserId, caps.perAuthor) ||
      atCap(byLocation, candidate.locationId, caps.perLocation) ||
      atCap(byEvent, candidate.realWorldEventId, caps.perRealWorldEvent)
    ) {
      continue;
    }

    count(byAuthor, candidate.authorUserId);
    count(byLocation, candidate.locationId);
    count(byEvent, candidate.realWorldEventId);
    kept.push(candidate);
  }

  return kept;
}

/**
 * Whether a facet has already taken its share.
 *
 * @param counts - How many of each have been kept.
 * @param key - Which one, or undefined where the candidate has no such facet.
 * @param cap - How many are allowed.
 * @returns Whether this candidate would exceed the cap. Always false for a
 *   candidate that has no such facet: there is nothing to concentrate around.
 */
function atCap(counts: Map<string, number>, key: string | undefined, cap: number): boolean {
  return key !== undefined && (counts.get(key) ?? 0) >= cap;
}

/**
 * Record that one more has been kept.
 *
 * @param counts - How many of each have been kept.
 * @param key - Which one, or undefined to count nothing.
 * @returns Nothing.
 */
function count(counts: Map<string, number>, key: string | undefined): void {
  if (key !== undefined) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
}

/**
 * How many candidates to retrieve to fill a page of a given size.
 *
 * The caps mean some of what is retrieved will be discarded, so a page of
 * twenty needs more than twenty candidates to fill. Bounded rather than
 * unlimited: `search.md:259` permits over-fetching to satisfy a page and
 * requires the factor be bounded, preferring a sparse page to an unbounded
 * scan. A page that comes back short because diversity discarded the rest is an
 * honest page.
 *
 * @param limit - The page size asked for.
 * @returns How many to ask the store for.
 */
export function overFetchFor(limit: number): number {
  return Math.min(limit * 4, 200);
}
