import type { NewMoments, ViewSpecification } from "@chronologity/contracts";

/**
 * Deciding whether a stored count is worth showing anybody.
 *
 * A count is computed away from the read path and read back later, so by the
 * time somebody sees it, it is a claim about the past. Everything here is about
 * refusing to make that claim when it can no longer be trusted — and **saying
 * nothing is always available**, because the contract distinguishes "we do not
 * know" from "nothing new".
 */

/**
 * How long a count may be shown before it is treated as unknown.
 *
 * The property this buys is that the privacy argument does not depend on the
 * sweep worker being up. Eligibility can narrow after a count is taken — a
 * Moment goes private, a moderation decision lands — and the sweep is what
 * notices. A worker that has been down for a day would otherwise go on showing
 * day-old numbers; past this it shows none.
 *
 * Six hours rather than minutes: the sweep must comfortably outpace it or every
 * badge blanks at once, and a count that is a few hours old is still worth
 * something on a Timeline measured in decades.
 */
export const MAXIMUM_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * How much of a rolling window may pass before its count is treated as unknown.
 *
 * A rolling range slides, so it *expels* history as well as admitting it: a
 * Moment counted yesterday under "the last thirty days" has fallen out today,
 * and the stored number now promises more than opening the view would produce.
 * Dividing the window bounds that drift proportionally — a view of "today"
 * blanks within the hour, a view of "the last three years" behaves like any
 * fixed one.
 */
const ROLLING_DIVISOR = 24;

/** Milliseconds in each unit a rolling range may count in. */
const UNIT_MS = {
  day: 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
} as const;

/** What the store holds for one view. */
export interface StoredAwareness {
  readonly newMomentCount: number;
  readonly capped: boolean;
  /** Which visit it was counted against; null before anything counted it. */
  readonly visitedThrough: Date | null;
  /** When it was counted; null when nothing has. */
  readonly computedAt: Date | null;
}

/**
 * How long a view's count stays trustworthy.
 *
 * @param view - What it points at. A rolling range shortens the budget.
 * @returns The budget in milliseconds.
 */
export function budgetFor(view: ViewSpecification): number {
  if (view.range?.kind !== "rolling") {
    return MAXIMUM_AGE_MS;
  }

  return Math.min(MAXIMUM_AGE_MS, (UNIT_MS[view.range.unit] * view.range.count) / ROLLING_DIVISOR);
}

/**
 * A stored count as its owner should see it, or nothing.
 *
 * Three separate reasons to say nothing, and they are deliberately not
 * distinguished from one another in the answer: a client that could tell "never
 * counted" from "gone stale" would be reading the health of a worker.
 *
 * @param stored - What the store holds, or undefined when it holds no row.
 * @param view - What the view points at, which decides the budget.
 * @param lastVisitedAt - When its owner last looked, or null if never.
 * @param now - Injected so a test can pin what counts as stale.
 * @returns The count, or undefined when it is not known.
 */
export function presentAwareness(
  stored: StoredAwareness | undefined,
  view: ViewSpecification,
  lastVisitedAt: Date | null,
  now: Date = new Date(),
): NewMoments | undefined {
  if (stored?.computedAt == null) {
    return undefined;
  }

  // Counted against a visit that has since been superseded. The number is "new
  // since the *previous* time they looked", which after a fresh visit would
  // mean telling somebody about history they have just been through.
  if (stored.visitedThrough?.getTime() !== lastVisitedAt?.getTime()) {
    return undefined;
  }

  if (now.getTime() - stored.computedAt.getTime() > budgetFor(view)) {
    return undefined;
  }

  return {
    count: stored.newMomentCount,
    capped: stored.capped,
    asOf: stored.computedAt.toISOString(),
  };
}

/**
 * The instant a view's count is measured from.
 *
 * @param createdAt - When the view was saved.
 * @param lastVisitedAt - When its owner last looked, or null if never.
 * @returns The mark. A view nobody has opened counts from when it was saved,
 *   because everything matching it since then is something they have not seen —
 *   which is a truer answer than calling the whole of history new.
 */
export function markFor(createdAt: Date, lastVisitedAt: Date | null): Date {
  return lastVisitedAt ?? createdAt;
}
