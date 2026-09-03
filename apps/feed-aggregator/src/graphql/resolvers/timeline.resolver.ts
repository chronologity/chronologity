import type { TimelineScopeRef } from "@chronologity/timeline-derivation";
import {
  connectionFor,
  entryFor,
  type TimelineConnection,
  type TimelineEntry,
} from "../../timelines/timeline-composer.js";
import {
  specificationFor,
  type PagingArguments,
  type TimelineViewArguments,
} from "../../timelines/timeline-request.js";
import type { GraphQLContext } from "../context/graphql-context.js";

/**
 * Reading a Timeline.
 *
 * Thin by rule (`feed.md:243`): coerce the arguments into the object the engine
 * takes, resolve what this Viewer may see, read, and arrange the result. No SQL
 * and no eligibility algorithm lives here — a resolver holding either would be a
 * place where a decision about somebody's history could be made without
 * anything owning it.
 *
 * The arguments are turned into a specification before eligibility is resolved.
 * That order is deliberate: a refusal at this stage describes only what the
 * client sent, and resolving first would send a scope identifier the contract
 * has not checked to PostgreSQL.
 */

/** What `Query.timeline` receives. */
interface TimelineArguments extends PagingArguments {
  readonly view: TimelineViewArguments;
}

/** What `Query.timelineHead` receives. */
interface HeadArguments {
  readonly view: TimelineViewArguments;
}

/**
 * Which scope a specification names.
 *
 * @param context - The specification's context.
 * @returns The scope reference eligibility is resolved for. The two vocabularies
 *   are the same by construction, which is why this is a rename rather than a
 *   translation.
 */
function scopeOf(context: { type: TimelineScopeRef["type"]; id: string }): TimelineScopeRef {
  return { type: context.type, id: context.id };
}

/** The Timeline fields on `Query`. */
export const timelineQueries = {
  /**
   * A page of history.
   *
   * @param _parent - Unused; this is a root field.
   * @param args - The view, and where in it the reader is.
   * @param context - Carries the Viewer, what they may see, and the read model.
   * @returns The page, newest first, with a cursor at each end. Empty for a
   *   Timeline its owner has closed, which is indistinguishable from one holding
   *   nothing — refusing would say there was something there to refuse.
   * @throws {ValidationError} If the arguments do not describe a view.
   * @throws {UnauthenticatedError} If the request offered no credential:
   *   reading history requires an account.
   * @throws {OnboardingRequiredError} If somebody is signed in but has not
   *   finished creating an account.
   */
  async timeline(
    _parent: unknown,
    args: TimelineArguments,
    context: GraphQLContext,
  ): Promise<TimelineConnection> {
    const { view, from } = specificationFor(args.view, args);
    const viewer = await context.eligibility.forScope(scopeOf(view.context));

    return connectionFor(await context.timeline.page(view, viewer, from), view, from !== undefined);
  },

  /**
   * Where a Timeline opens.
   *
   * A page of one rather than a query of its own: the newest thing a view holds
   * is the first thing it would page to, and two ways of asking could disagree.
   *
   * The newest *occurrence*, never the newest recording — a Moment added today
   * about 1969 belongs in 1969, and letting it become the head would put
   * somebody at the wrong end of their own history the moment they backfilled
   * anything.
   *
   * @param _parent - Unused; this is a root field.
   * @param args - The view to open.
   * @param context - Carries the Viewer, what they may see, and the read model.
   * @returns The entry the Timeline opens at, or null when it holds none — for
   *   somebody with no history, and equally for a Timeline closed to this
   *   reader.
   * @throws {ValidationError} If the arguments do not describe a view.
   * @throws {UnauthenticatedError} If the request offered no credential.
   * @throws {OnboardingRequiredError} If onboarding is unfinished.
   */
  async timelineHead(
    _parent: unknown,
    args: HeadArguments,
    context: GraphQLContext,
  ): Promise<TimelineEntry | null> {
    const { view } = specificationFor(args.view);
    const viewer = await context.eligibility.forScope(scopeOf(view.context));
    const slice = await context.timeline.page(
      { ...view, limit: 1, direction: "older" },
      viewer,
      undefined,
    );
    const row = slice.rows[0];

    return row === undefined ? null : entryFor(row);
  },
};

/**
 * Which member of the entry union a row is.
 *
 * Decided from what the query reported rather than from which fields happen to
 * be present. A Moment somebody may not read is its own type rather than the
 * readable one with fields left out, so that a client cannot ask for what it
 * may not have.
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
