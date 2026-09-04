import type { GraphQLResolveInfo } from "graphql";
import { getTemporalDistribution } from "../../timelines/queries/get-temporal-distribution.query.js";
import { getTimelineHead } from "../../timelines/queries/get-timeline-head.query.js";
import { getTimelineSlice } from "../../timelines/queries/get-timeline-slice.query.js";
import type { TemporalDistribution } from "../../timelines/services/distribution-composer.js";
import type { GraphQLScale } from "../../timelines/services/distribution-request.js";
import type { TimelineConnection, TimelineEntry } from "../../timelines/services/timeline-composer.js";
import type {
  PagingArguments,
  TimelineViewArguments,
} from "../../timelines/services/timeline-request.js";
import type { GraphQLContext } from "../context/graphql-context.js";
import { selectsField } from "../selects-field.js";

/**
 * Reading a Timeline.
 *
 * Thin by rule (`feed.md:243`), and thin here means almost empty: each field
 * unpacks its arguments and calls the composition function that owns the work.
 * No SQL, no eligibility algorithm and no ordering decision lives in this file —
 * a resolver holding any of those would be a place where a decision about
 * somebody's history could be made without anything owning it.
 *
 * The one thing that does live here is the union's `resolveType`, because that
 * is a statement about the schema rather than about history.
 */

/** What `Query.timeline` receives. */
interface TimelineArguments extends PagingArguments {
  readonly view: TimelineViewArguments;
}

/** What `Query.timelineHead` receives. */
interface HeadArguments {
  readonly view: TimelineViewArguments;
}

/** What `Query.temporalDistribution` receives. */
interface DistributionArguments {
  readonly view: TimelineViewArguments;
  readonly scale: GraphQLScale;
}

/** The Timeline fields on `Query`. */
export const timelineQueries = {
  /**
   * A page of history.
   *
   * @param _parent - Unused; this is a root field.
   * @param args - The view, and where in it the reader is.
   * @param context - Carries the Viewer, what they may see, and the read model.
   * @returns The page, newest first, with a cursor at each end.
   * @throws {ValidationError} If the arguments do not describe a view.
   * @throws {UnauthenticatedError} If the request offered no credential.
   * @throws {OnboardingRequiredError} If onboarding is unfinished.
   */
  async timeline(
    _parent: unknown,
    args: TimelineArguments,
    context: GraphQLContext,
  ): Promise<TimelineConnection> {
    return getTimelineSlice(args.view, args, context);
  },

  /**
   * Where a Timeline opens.
   *
   * @param _parent - Unused; this is a root field.
   * @param args - The view to open.
   * @param context - Carries the Viewer, what they may see, and the read model.
   * @returns The entry the Timeline opens at, or null when it holds none.
   * @throws {ValidationError} If the arguments do not describe a view.
   * @throws {UnauthenticatedError} If the request offered no credential.
   * @throws {OnboardingRequiredError} If onboarding is unfinished.
   */
  async timelineHead(
    _parent: unknown,
    args: HeadArguments,
    context: GraphQLContext,
  ): Promise<TimelineEntry | null> {
    return getTimelineHead(args.view, context);
  },

  /**
   * The same history, read span by span rather than Moment by Moment.
   *
   * @param _parent - Unused; this is a root field.
   * @param args - The view, and how coarsely to read it.
   * @param context - Carries the Viewer, what they may see, and both read
   *   models.
   * @param info - Read once, to decide whether the statement choosing
   *   representatives is issued at all. The only place this resolver looks at
   *   the query rather than at its arguments, and it is what keeps a
   *   distribution to one statement per store however many spans it covers.
   * @returns The spans holding anything, and the interval that was read.
   * @throws {ValidationError} If the arguments do not describe a view, if it
   *   names no stretch of time, if it reaches before history is held, or if the
   *   stretch and the scale would be too many spans to answer.
   * @throws {UnauthenticatedError} If the request offered no credential.
   * @throws {OnboardingRequiredError} If onboarding is unfinished.
   */
  async temporalDistribution(
    _parent: unknown,
    args: DistributionArguments,
    context: GraphQLContext,
    info: GraphQLResolveInfo,
  ): Promise<TemporalDistribution> {
    return getTemporalDistribution(
      args.view,
      args.scale,
      selectsField(info, "representatives"),
      context,
    );
  },
};

/**
 * Which member of the entry union a row is.
 *
 * Decided from what the query reported rather than from which fields happen to
 * be present. A Moment somebody may not read is its own type rather than the
 * readable one with fields left out, so that a client cannot ask for what it may
 * not have.
 */
export const timelineEntryResolver = {
  /**
   * Name the type.
   *
   * @param value - The entry a resolver produced.
   * @returns The type name, matching the SDL.
   */
  resolveType(value: TimelineEntry): string {
    return value.readable ? "ReadableTimelineEntry" : "WithheldTimelineEntry";
  },
};
