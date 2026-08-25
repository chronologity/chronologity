/**
 * Turning what is known about a Moment into a significance value.
 *
 * Pure, and deliberately small. `historical-significance.md` says the exact
 * computation is an architectural decision, and keeps insisting on one thing
 * throughout: significance describes why a Moment matters within the history
 * being examined, never how much attention it received.
 *
 * Nothing here takes a reaction count, a comment count, or a view. That is
 * enforced by construction rather than by intention — this module imports
 * nothing from either feature, and a test asserts it, because the architecture
 * constraints ask that engagement stay separable "so that a future optimization
 * cannot casually turn reaction or view counts into historical importance".
 */

/**
 * The identity of this scoring algorithm.
 *
 * Stored beside every value so that algorithm evolution can be told from
 * historical change. Raise it when a function here changes what it would score
 * for unchanged history.
 */
export const ALGORITHM_VERSION = "significance-v1";

/** The eight dimensions `historical-significance.md:117` names. */
export type SignificanceDimension =
  | "causal"
  | "structural"
  | "temporal"
  | "personal"
  | "collective"
  | "event"
  | "evidentiary"
  | "retrospective";

/** Where a value came from, kept so provenance survives the system growing. */
export type SignificanceProvenance = "human" | "graph" | "rule" | "ai";

/** What the graph knows about a Moment's causal position. */
export interface CausalFacts {
  /** Everything reachable downstream, not merely what it points at directly. */
  readonly descendantCount: number;
  /** How many causal claims point at it. */
  readonly ancestorCount: number;
}

/**
 * Score how consequential a Moment was to what followed.
 *
 * Reachable descendants rather than direct edges. Invariant 7 forbids reducing
 * this to out-degree, and the document's own example is why: in `A → B → C → D`
 * the first Moment has one outgoing edge and the whole chain depends on it.
 *
 * @param facts - What the causal graph knows about it.
 * @returns Its causal significance. Zero when nothing descends from it, which is
 *   the ordinary case and not a defect.
 */
export function scoreCausal(facts: CausalFacts): number {
  return facts.descendantCount;
}

/** Where a Moment sits in the wider shape of history. */
export interface StructuralFacts {
  /** Causal claims pointing at it. */
  readonly incomingEdges: number;
  /** Causal claims leading from it. */
  readonly outgoingEdges: number;
  /** How many distinct places and Events it touches. */
  readonly contextCount: number;
}

/**
 * Score how much a Moment holds history together.
 *
 * A Moment that both follows from something and leads to something joins two
 * stretches of history that would otherwise be separate — the document calls
 * this a convergence or divergence point, and says such a Moment may matter
 * "even if Users have never explicitly marked it as important".
 *
 * @param facts - Its edges and the contexts it touches.
 * @returns Its structural significance. A Moment that only ends a chain, or only
 *   begins one, scores lower than one that bridges: bridging is the property
 *   being measured, not busyness.
 */
export function scoreStructural(facts: StructuralFacts): number {
  const bridges = facts.incomingEdges > 0 && facts.outgoingEdges > 0;

  return (bridges ? 2 : 0) + facts.contextCount;
}

/** Whether a Moment sits at an edge of some stretch of history. */
export interface TemporalFacts {
  /** The earliest or latest its author has recorded. */
  readonly boundsRecord: boolean;
  /** The earliest or latest at the place it happened. */
  readonly boundsPlace: boolean;
  /** The earliest or latest of those tied to one of its Events. */
  readonly boundsEvent: boolean;
}

/**
 * Score a Moment as a beginning or an ending.
 *
 * Inferred from position alone — the earliest photograph somebody has at a
 * place, the first tied to an Event, the oldest in a record. Deterministic, and
 * it invents nothing: a gap-based rule would need a threshold nobody could
 * justify, and an arbitrary constant here is exactly the accidental definition
 * of importance the document warns against.
 *
 * What this misses — a turning point leaving no trace in the data — the personal
 * mark covers.
 *
 * @param facts - Which stretches of history it bounds.
 * @returns Its temporal significance, one per boundary it forms.
 */
export function scoreTemporal(facts: TemporalFacts): number {
  return [facts.boundsRecord, facts.boundsPlace, facts.boundsEvent].filter(Boolean).length;
}

/**
 * Score somebody's own attribution.
 *
 * Binary, because the mark is. `historical-significance.md:305` says the initial
 * product does not need a numerical personal rating, and invariant 12 is why
 * this is scoped to one person rather than summed: a mark says something about
 * that person's relationship to the Moment and nothing about universal
 * importance.
 *
 * @param marked - Whether they marked it.
 * @returns Its personal significance in their scope.
 */
export function scorePersonal(marked: boolean): number {
  return marked ? 1 : 0;
}

/** How many separate histories converge on one occurrence. */
export interface CollectiveFacts {
  /** Distinct people with a Moment in this scope — never Moment count. */
  readonly distinctAuthors: number;
}

/**
 * Score independent convergence on the same history.
 *
 * Distinct authors, never volume. Invariant 13 forbids reducing this to raw
 * Moment count, and invariant 14 says independent convergence means more than
 * duplicated or coordinated volume — one person posting forty times is one
 * perspective.
 *
 * **This dimension is knowingly weak.** The document asks how Chronologity should
 * prevent coordinated posting from manufacturing collective significance, and
 * that is unsolved: distinct authors raise the cost of gaming it without
 * removing it. It carries its own algorithm version so it can be replaced
 * alone.
 *
 * @param facts - How many separate people are represented.
 * @returns Its collective significance. One author is convergence with nobody,
 *   so a single perspective scores nothing.
 */
export function scoreCollective(facts: CollectiveFacts): number {
  return Math.max(0, facts.distinctAuthors - 1);
}

/** A Moment's position among those tied to one Event. */
export interface EventFacts {
  /** How many Moments are tied to the Event. */
  readonly momentsInEvent: number;
  /** Whether this is the only one. */
  readonly isOnlyRecord: boolean;
}

/**
 * Score a Moment's importance within its Event.
 *
 * Invariant 15: Moments tied to the same Event may differ in significance. The
 * one photograph anybody has of an occurrence carries it entirely; one of two
 * hundred carries less, though the Event may be enormous.
 *
 * @param facts - How much company it has.
 * @returns Its significance within that Event.
 */
export function scoreEvent(facts: EventFacts): number {
  if (facts.momentsInEvent === 0) {
    return 0;
  }

  return facts.isOnlyRecord ? 3 : 1;
}

/** What other accounts say about the same occurrence. */
export interface EvidentiaryFacts {
  /** Independent accounts of substantially the same occurrence. */
  readonly corroborations: number;
  /** Accounts disputing what it represents. */
  readonly contradictions: number;
}

/**
 * Score how well corroborated a Moment is.
 *
 * Corroboration raises it; dispute does not. Invariant 16 is emphatic that
 * evidentiary significance "does not establish guaranteed truth" — several
 * people recording the same afternoon makes it better attested, not proven, and
 * a contradiction makes it contested rather than false.
 *
 * A dispute therefore withholds corroboration rather than scoring negatively:
 * being argued about is not evidence of anything either way.
 *
 * @param facts - Corroborating and contradicting accounts.
 * @returns Its evidentiary significance, never below zero.
 */
export function scoreEvidentiary(facts: EvidentiaryFacts): number {
  return Math.max(0, facts.corroborations - facts.contradictions);
}

/**
 * Score how far later history has changed the reading of an earlier Moment.
 *
 * Not a separate analysis. "Later causal history may increase the significance
 * of earlier Moments" is a property of recomputing, and it becomes observable
 * only by remembering what a Moment scored when first assessed.
 *
 * @param current - What causal significance scores now.
 * @param baseline - What it scored the first time it was ever assessed.
 * @returns How much it has risen. A Moment whose descendants were all known at
 *   the start has acquired nothing retrospectively, however consequential it
 *   was — and one that falls has not acquired negative significance.
 */
export function scoreRetrospective(current: number, baseline: number): number {
  return Math.max(0, current - baseline);
}
