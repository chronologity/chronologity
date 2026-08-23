import type { MomentVisibility } from "@chronologity/contracts";

/**
 * Who may see a Moment.
 *
 * Pure, and separate from the Moment policy that governs editing, because the
 * two answer different questions about different people: that one asks whether
 * a change is coherent, this one asks whether somebody is entitled to look.
 *
 * `privacy.md:88` defines visibility as determining "who may access it through
 * ordinary Chronologity product experiences", and the vocabulary is the three
 * values `privacy.md:92` names. There is deliberately no value meaning
 * "followers": `social-graph.md:490` says a Follow does not override privacy,
 * so following says what somebody wants to hear about and never what they may
 * see.
 */

/** Why somebody may not see a Moment. */
export type ViewRefusal = "blocked" | "not_in_audience" | "private" | "unknown_visibility";

/** What the caller had to look up before the rule could be applied. */
export interface ViewFacts {
  /** Whether a block runs between the two people, in either direction. */
  readonly blockedEitherWay: boolean;
  /** Whether the viewer is on this Moment's list. Only consulted when restricted. */
  readonly inAudience: boolean;
}

/**
 * Decide whether a Viewer may see a Moment.
 *
 * Order matters. The author is answered before blocking, because a block must
 * never hide somebody's own history from them. Blocking is answered before
 * visibility, because a public Moment is still not for somebody a block
 * separates you from — which is the requirement 5I-3 could only satisfy
 * vacuously, there being no access to survive a block at the time.
 *
 * @param viewerUserId - Who is asking.
 * @param moment - Whose it is and who it is for.
 * @param facts - What the caller looked up: whether a block separates the two,
 *   and whether the Viewer is on the Moment's list.
 * @returns Why to refuse, or undefined when the Viewer may see it. Every reason
 *   is reported to the caller identically, as a Moment that does not exist; the
 *   distinction exists so the rule can be read and tested, not so it can be
 *   announced.
 */
export function checkVisibility(
  viewerUserId: string,
  moment: { readonly authorUserId: string; readonly visibility: MomentVisibility },
  facts: ViewFacts,
): ViewRefusal | undefined {
  if (moment.authorUserId === viewerUserId) {
    return undefined;
  }

  if (facts.blockedEitherWay) {
    return "blocked";
  }

  switch (moment.visibility) {
    case "public":
      return undefined;
    case "restricted":
      return facts.inAudience ? undefined : "not_in_audience";
    case "private":
      return "private";
    default:
      // Unreachable while the column constraint and the contract agree, and
      // deliberately here anyway: a visibility nobody recognises must refuse
      // rather than fall through to permission. Default deny is the rule for
      // ambiguous authorization state, and a widened constraint that forgot
      // this file should break a test rather than publish somebody's history.
      return "unknown_visibility";
  }
}
