import type { MomentRelationshipKind, Occurrence } from "@chronologity/contracts";

/**
 * What may be claimed about two Moments, and what may not.
 *
 * Pure, and built on one rule that the rest follows from
 * (`causality.md:103`):
 *
 * > If Moment A occurred before Moment B, Chronologity knows only that A
 * > preceded B.
 *
 * Nothing here derives a relationship. Every relationship is a claim somebody
 * made, and this decides whether the claim is coherent — not whether it is
 * true. `causality.md:485` is explicit that Chronologity should not assign
 * causal claims a pseudo-scientific probability: "Human histories are not
 * improved by false mathematical precision."
 */

/** Why a claim cannot be recorded. */
export type RelationshipRefusal =
  | "self_reference"
  | "not_yours"
  | "effect_precedes_cause"
  | "reciprocal_cause"
  | "unknown_kind";

/**
 * The kinds that assert one Moment influenced another.
 *
 * Only these carry a temporal rule and a reciprocity rule, because only these
 * claim a direction in which history moved. `causality.md:643` asks that cycle
 * restrictions "apply according to relationship type rather than to the entire
 * relationship graph", and this is that distinction.
 */
const CAUSAL_KINDS = new Set<MomentRelationshipKind>(["led_to", "contributed_to"]);

/**
 * The kinds that mean the same thing read from either end.
 *
 * Two accounts of one afternoon are each the other's alternate perspective;
 * neither is the source in any meaningful sense. Storing such a claim twice
 * would report one relationship as two.
 */
const SYMMETRIC_KINDS = new Set<MomentRelationshipKind>([
  "related_to",
  "alternate_perspective",
  "contradicts",
]);

/**
 * Whether a kind claims that one Moment influenced another.
 *
 * @param kind - The relationship kind.
 * @returns Whether it is causal. A kind nobody recognises is not, so an
 *   unrecognised value never acquires the rules that govern causation.
 */
export function isCausal(kind: MomentRelationshipKind): boolean {
  return CAUSAL_KINDS.has(kind);
}

/**
 * Whether a kind means the same read from either end.
 *
 * @param kind - The relationship kind.
 * @returns Whether it is symmetric.
 */
export function isSymmetric(kind: MomentRelationshipKind): boolean {
  return SYMMETRIC_KINDS.has(kind);
}

/**
 * Whether known occurrence times contradict a claimed direction of influence.
 *
 * Three-valued in effect, though only one answer refuses. A cause may occur
 * before its effect or during it; what it may not do is occur entirely
 * afterwards. Anything else — including genuinely unknown order — is permitted,
 * because `causality.md:281` requires that uncertainty be preserved rather than
 * resolved: *unknown order ≠ invalid relationship*.
 *
 * So "sometime in 1998" leading to "June 1998" is allowed. Chronologity does
 * not know whether it did, and inventing an answer either way would fabricate
 * precision the history does not have.
 *
 * @param cause - When the influencing Moment happened, as an interval.
 * @param effect - When the influenced Moment happened, as an interval.
 * @returns Whether the claim contradicts what is known. True only when the
 *   cause's interval begins strictly after the effect's interval ends, which is
 *   the one arrangement no uncertainty can rescue.
 */
export function contradictsKnownTime(cause: Occurrence, effect: Occurrence): boolean {
  return new Date(cause.start).getTime() > new Date(effect.end).getTime();
}

/** What the caller had to establish before the claim could be judged. */
export interface RelationshipFacts {
  /** Who is making the claim. */
  readonly asserterUserId: string;
  /** Who wrote the Moment the claim starts from. */
  readonly sourceAuthorUserId: string;
  /** Who wrote the Moment the claim points at. */
  readonly targetAuthorUserId: string;
  /** When each happened, for the temporal rule. */
  readonly sourceOccurrence: Occurrence;
  readonly targetOccurrence: Occurrence;
  /** Whether a causal claim already runs the other way between this pair. */
  readonly reciprocalCausalExists: boolean;
}

/**
 * Decide whether a claim about two Moments may be recorded.
 *
 * @param sourceMomentId - The Moment the claim starts from.
 * @param targetMomentId - The Moment it points at.
 * @param kind - What is being claimed.
 * @param facts - Authorship, occurrence times, and whether a causal claim
 *   already runs the other way.
 * @returns Why to refuse, or undefined when the claim may be recorded.
 */
export function checkRelationship(
  sourceMomentId: string,
  targetMomentId: string,
  kind: MomentRelationshipKind,
  facts: RelationshipFacts,
): RelationshipRefusal | undefined {
  if (sourceMomentId === targetMomentId) {
    return "self_reference";
  }

  // One end must be the claimant's own history. This is what lets somebody say
  // "my photograph of that afternoon is another account of yours" while keeping
  // every claim anchored to a history its author actually lived.
  if (
    facts.sourceAuthorUserId !== facts.asserterUserId &&
    facts.targetAuthorUserId !== facts.asserterUserId
  ) {
    return "not_yours";
  }

  if (!isCausal(kind)) {
    // A kind nobody recognises reaches here and is refused, rather than
    // slipping past the causal rules by not being causal.
    return isSymmetric(kind) ? undefined : "unknown_kind";
  }

  if (contradictsKnownTime(facts.sourceOccurrence, facts.targetOccurrence)) {
    return "effect_precedes_cause";
  }

  // A logical contradiction rather than a temporal one, which is why it is
  // checked separately: "A led to B" and "B led to A" cannot both hold whatever
  // the dates say, including when the dates are too coarse to order at all.
  if (facts.reciprocalCausalExists) {
    return "reciprocal_cause";
  }

  return undefined;
}

/**
 * Say why a claim was refused, in words fit for whoever made it.
 *
 * @param reason - The refusal.
 * @returns A sentence naming what is wrong, so the person can correct the
 *   direction or the dates rather than guess. `causality.md:263` asks that the
 *   product "help resolve the contradiction rather than rewriting history
 *   automatically", and saying plainly what conflicts is how an API does that.
 */
export function describeRelationshipRefusal(reason: RelationshipRefusal): string {
  switch (reason) {
    case "self_reference":
      return "A moment cannot be related to itself";
    case "not_yours":
      return "One of the two moments must be your own";
    case "effect_precedes_cause":
      return "That moment happened after the one it is said to have led to";
    case "reciprocal_cause":
      return "Those moments are already said to lead the other way";
    case "unknown_kind":
      return "That is not a kind of relationship Chronologity records";
  }
}
