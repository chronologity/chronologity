import type { MatchReason } from "@chronologity/contracts";

/**
 * Turning a candidate into something a person reads.
 *
 * Pure. Snippets and match reasons are derived presentation, generated at query
 * time from text the Viewer has already been found eligible for. A snippet
 * never widens what the result discloses: everything it can contain was already
 * going to be returned.
 *
 * Highlighting explains why something matched. It implies nothing about whether
 * what matched is historically important — `search.md:410` is explicit, and the
 * distinction matters in a product where the two are easily confused.
 */

/** How long a snippet may be. */
const SNIPPET_LENGTH = 160;

/** How much context to keep before the first match. */
const LEAD = 40;

/**
 * A fragment of text around what matched.
 *
 * @param text - The indexed text, which the Viewer is already entitled to.
 * @param terms - The words that were searched for, lowercased.
 * @returns A bounded fragment centred on the first match, or the opening of the
 *   text when nothing matched within it — which happens when the match was on a
 *   title or an alias rather than here. Null for empty text, so a caller renders
 *   nothing rather than an empty quotation.
 */
export function snippet(text: string, terms: readonly string[]): string | null {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const lowered = trimmed.toLowerCase();
  const found = terms
    .map((term) => lowered.indexOf(term))
    .filter((index) => index >= 0)
    .sort((one, other) => one - other)[0];

  if (found === undefined) {
    return clip(trimmed, 0);
  }

  return clip(trimmed, Math.max(0, found - LEAD));
}

/**
 * Cut a fragment out of a longer text.
 *
 * @param text - The whole text.
 * @param from - Where the fragment starts.
 * @returns The fragment, with an ellipsis on each side that was cut. Nothing is
 *   invented: the ellipsis marks removal rather than standing in for words
 *   nobody wrote.
 */
function clip(text: string, from: number): string {
  const end = Math.min(text.length, from + SNIPPET_LENGTH);
  const body = text.slice(from, end);

  return `${from > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

/** What the caller knows about why something was retrieved. */
export interface MatchContext {
  readonly title: string;
  readonly aliases: string;
  readonly body: string;
  readonly phrase: string;
  readonly terms: readonly string[];
  readonly hadTemporalFilter: boolean;
  readonly hadProximityFilter: boolean;
  readonly hadCreatorFilter: boolean;
  readonly hadEventFilter: boolean;
  readonly hadLocationFilter: boolean;
}

/**
 * Why this matched.
 *
 * Derived from the signals that actually contributed rather than reconstructed
 * afterwards by a client guessing. `search.md:421` does not ask for every
 * ranking weight to be exposed, but says being unable to explain an obvious
 * result is not acceptable.
 *
 * @param context - The candidate's text and what was asked.
 * @returns The reasons, most specific first. Never empty — something retrieved
 *   this, and a result that cannot say why it is here is exactly what the
 *   document warns against; a filter-only search reports the filter.
 */
export function matchReasons(context: MatchContext): MatchReason[] {
  const reasons: MatchReason[] = [];
  const phrase = context.phrase.toLowerCase();
  const title = context.title.toLowerCase();

  if (phrase.length > 0) {
    if (title === phrase) {
      reasons.push("exact_title_match");
    } else if (containsAny(title, context.terms)) {
      reasons.push("title_match");
    }

    if (containsAny(context.aliases.toLowerCase(), context.terms)) {
      reasons.push("alias_match");
    }

    if (containsAny(context.body.toLowerCase(), context.terms)) {
      reasons.push("caption_match");
    }
  }

  if (context.hadTemporalFilter) {
    reasons.push("temporal_match");
  }

  if (context.hadProximityFilter) {
    reasons.push("proximity_match");
  }

  if (context.hadLocationFilter) {
    reasons.push("location_match");
  }

  if (context.hadEventFilter) {
    reasons.push("event_match");
  }

  if (context.hadCreatorFilter) {
    reasons.push("creator_match");
  }

  // A near-miss on spelling retrieves without any term appearing literally, so
  // there is a real path to an empty list. Saying the title matched is the
  // truthful minimum: it is why the store returned this row.
  return reasons.length > 0 ? reasons : ["title_match"];
}

/**
 * Whether any of the words appears in the text.
 *
 * @param text - Lowercased text.
 * @param terms - Lowercased words.
 * @returns Whether at least one appears.
 */
function containsAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => term.length > 0 && text.includes(term));
}
