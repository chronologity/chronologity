import {
  HISTORY_FLOOR,
  MAX_SPANS_PER_REQUEST,
  spansBetween,
  type TimelineScale,
  type ViewSpecification,
} from "@chronologity/contracts";
import { resolveRange } from "@chronologity/timeline-derivation";
import { ValidationError } from "../../errors/aggregator-error.js";
import { specificationFor, type TimelineViewArguments } from "./timeline-request.js";

/**
 * Deciding whether a zoomed request can be answered before asking any store.
 *
 * Reading history coarsely returns one row per span rather than one per Moment,
 * so what comes *back* is bounded by how much history exists. What the stores
 * *do* is not: they read the whole stretch whatever they give back. A decade
 * asked for day by day is three and a half thousand spans of work to produce a
 * handful of rows.
 *
 * So the size is computed from the range and the scale — both of which the
 * client sent — and a request that would sweep too much is refused. **Refused
 * rather than trimmed**, because a distribution cut short misstates the shape of
 * somebody's history and nothing in the answer says it was cut. The refusal
 * happens before a connection is opened, so it describes only what the client
 * asked for, and no reader's history is touched to produce it.
 */

/** A scale as the schema names it. */
export type GraphQLScale = "DAY" | "WEEK" | "MONTH" | "YEAR" | "DECADE" | "CENTURY";

/**
 * The schema's scales against the contract's.
 *
 * Written out rather than lower-cased, so adding a scale to either side fails to
 * compile instead of producing one nothing buckets by.
 */
const SCALES: Record<GraphQLScale, TimelineScale> = {
  DAY: "day",
  WEEK: "week",
  MONTH: "month",
  YEAR: "year",
  DECADE: "decade",
  CENTURY: "century",
};

/** What to suggest when a stretch is too fine to answer whole. */
const NEXT_COARSEST: Record<TimelineScale, TimelineScale | undefined> = {
  day: "week",
  week: "month",
  month: "year",
  year: "decade",
  decade: "century",
  century: undefined,
};

/** How each scale is named in a sentence addressed to a person. */
const IN_WORDS: Record<TimelineScale, string> = {
  day: "day by day",
  week: "week by week",
  month: "month by month",
  year: "year by year",
  decade: "decade by decade",
  century: "century by century",
};

/**
 * A zoomed request, resolved and found answerable.
 *
 * The interval is here as instants rather than as the definition that produced
 * it, because a rolling range means something different every time it is asked
 * and both stores must be asked about the *same* stretch. It is also what the
 * answer carries back: a client drawing its own empty spans cannot otherwise
 * know which ones to draw.
 */
export interface DistributionRequest {
  readonly view: ViewSpecification;
  readonly scale: TimelineScale;
  readonly from: Date;
  readonly to: Date;
}

/**
 * Assemble a zoomed request, or refuse it.
 *
 * @param view - Whose history, which lens, what narrowing, over what stretch.
 * @param scale - How coarsely to read it.
 * @param now - What "the last thirty days" is counted back from. Injected so a
 *   test can pin it, and resolved once here so both stores are asked about one
 *   interval rather than two that drift by however long the first query took.
 * @returns The specification, the scale, and the interval actually being read.
 * @throws {ValidationError} If the view is not one the contract admits; if it
 *   names no stretch of time, which at this scale would mean the whole of
 *   history; if it reaches before the earliest instant the projection can hold;
 *   or if the stretch and the scale together would produce more spans than one
 *   request may answer.
 */
export function distributionFor(
  view: TimelineViewArguments,
  scale: GraphQLScale,
  now: Date = new Date(),
): DistributionRequest {
  const request = specificationFor(view);
  const reading = SCALES[scale];
  const range = resolveRange(request.view.range, now);

  // Everything, at day scale, is forty-six thousand spans. A view with no range
  // is perfectly readable as a Timeline — it pages — and simply is not a
  // question this shape can answer.
  if (range === undefined) {
    throw new ValidationError(
      "Reading history by span needs a stretch of time: give the view a fixed or rolling range",
    );
  }

  // Below this the projection does not fail, it silently answers as though the
  // instant were 1900 — and the week arithmetic stops being correct at the same
  // point. Refused rather than clamped, because clamping would return spans
  // labelled with years nobody asked about.
  if (range.from.getTime() < HISTORY_FLOOR.getTime()) {
    throw new ValidationError(
      `History can be read back to ${HISTORY_FLOOR.getUTCFullYear()}; ask for a range that starts no earlier`,
    );
  }

  const spans = spansBetween(range.from, range.to, reading);

  if (spans > MAX_SPANS_PER_REQUEST) {
    throw new ValidationError(tooManySpans(reading, spans));
  }

  return {
    view: {
      ...request.view,
      // The scale is recorded on the specification as well as returned: a view
      // is something somebody can save, and one that reopened at a different
      // zoom would not be the same view.
      zoom: reading,
      // **Pinned to the instants it resolved to just now, and that is the point
      // rather than a convenience.** Two stores answer this request — one counts
      // and one chooses — and each would otherwise resolve "the last thirty
      // days" against its own clock, so they would read stretches differing by
      // however long the first query took. A Moment near the edge would then be
      // counted in a span that offers no representative, or offered as a
      // representative of a span nothing counted. Resolved once, here, so both
      // are asked about the same history.
      range: {
        kind: "fixed",
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
    },
    scale: reading,
    from: range.from,
    to: range.to,
  };
}

/**
 * What to tell somebody whose request was too wide to answer.
 *
 * Says what to do rather than what went wrong: the reader asked a reasonable
 * question about their own history, and the answer is a different question
 * rather than a fault.
 *
 * Exported so both of its branches can be exercised. Only `century` has no
 * coarser scale to suggest, and a century-scale request cannot in practice
 * exceed the bound — a calendar year is at most four digits, so the widest
 * stretch anyone can name is eighty-two centuries. The branch is written anyway,
 * because the alternative is a message reading "read it undefined" if that ever
 * stops being true.
 *
 * @param scale - How coarsely they asked to read.
 * @param spans - How many spans that would have been.
 * @returns The refusal, naming a coarser scale where there is one.
 */
export function tooManySpans(scale: TimelineScale, spans: number): string {
  const coarser = NEXT_COARSEST[scale];

  return (
    `Reading that stretch ${IN_WORDS[scale]} would be ${spans} spans, and one request answers ${MAX_SPANS_PER_REQUEST}. ` +
    (coarser === undefined
      ? "Ask for a shorter stretch."
      : `Ask for a shorter stretch, or read it ${IN_WORDS[coarser]}.`)
  );
}
