import type { ReactionKind } from "@chronologity/contracts";

/**
 * Whether somebody may respond to a Moment, and how.
 *
 * Pure. Being able to see a Moment does not by itself mean being able to react
 * to it — `reactions.md:264` asks that "can view" and "can react" stay
 * distinguishable — and two things can withhold the second while leaving the
 * first intact.
 *
 * Nothing here decides what a Reaction *means*. The four kinds describe the
 * reader, never the history: none of them amounts to saying a Moment happened
 * as represented, because no verification capability exists behind such a
 * claim (`reactions.md:99`).
 */

/** Why a Reaction cannot be left. */
export type ReactionRefusal = "reactions_disabled" | "blocked" | "unknown_kind";

/** The four the database constraint permits, in one place both can be read. */
const KINDS = new Set<ReactionKind>(["loved", "amused", "astonished", "saddened"]);

/**
 * Whether a kind is one Chronologity records.
 *
 * @param kind - What the caller asked for.
 * @returns Whether it is recognised. Schema validation refuses an unknown kind
 *   long before this, which is exactly why the check is repeated: a widened
 *   enum that forgot the database constraint should fail a test rather than
 *   store something nothing can read back.
 */
export function isReactionKind(kind: ReactionKind): boolean {
  return KINDS.has(kind);
}

/** What the caller had to establish before the reaction could be judged. */
export interface ReactionFacts {
  /** Whether this Moment is accepting reactions at all. */
  readonly reactionsEnabled: boolean;
  /** Whether a Block separates the reader from the Moment's author. */
  readonly blockedEitherWay: boolean;
}

/**
 * Decide whether a Reaction may be left.
 *
 * Blocking is answered before the Moment's own setting, because a Block is a
 * safety boundary and an author's interaction preference is not. Reversing them
 * would let a blocked person learn whether reactions were enabled, which is a
 * small thing to learn about somebody who wants nothing to do with them.
 *
 * @param kind - What is being left.
 * @param facts - Whether the Moment accepts reactions, and whether a Block
 *   separates the two people.
 * @returns Why to refuse, or undefined when the Reaction may be left.
 */
export function checkReaction(
  kind: ReactionKind,
  facts: ReactionFacts,
): ReactionRefusal | undefined {
  if (facts.blockedEitherWay) {
    return "blocked";
  }

  if (!facts.reactionsEnabled) {
    return "reactions_disabled";
  }

  if (!isReactionKind(kind)) {
    return "unknown_kind";
  }

  return undefined;
}

/**
 * Say why a Reaction was refused.
 *
 * @param reason - The refusal.
 * @returns A sentence for whoever tried. A Block is not named as one: telling
 *   somebody they have been blocked is precisely what the product must not do,
 *   so it is reported as the Moment simply not taking reactions.
 */
export function describeReactionRefusal(reason: ReactionRefusal): string {
  switch (reason) {
    case "blocked":
    case "reactions_disabled":
      return "This moment is not accepting reactions";
    case "unknown_kind":
      return "That is not a reaction Chronologity records";
  }
}
