import {
  HISTORY_FLOOR,
  identifierSchema,
  isSpanStart,
  spanEnd,
  viewSpecificationSchema,
  type TimelineScale,
  type ViewSpecification,
} from "@chronologity/contracts";
import type { TimelineScopeRef } from "@chronologity/timeline-derivation";
import { ValidationError } from "../../errors/aggregator-error.js";
import type { GraphQLContext } from "../../graphql/context/graphql-context.js";
import type { SearchEntityType } from "../../read-models/postgres/search-document-read-model.js";
import type { GraphQLScale } from "./distribution-request.js";

/**
 * Working out where somebody asked to go.
 *
 * Seven ways of naming a destination, and only two coordinates: an instant, and
 * sometimes a Moment sitting at it. The other five are ways of computing one of
 * those — an occasion carries its own start, a place carries none, a
 * relationship carries its far end, what a span was about is what temporal zoom
 * already picked, and something found is whichever of those its kind makes it.
 *
 * **Every destination is reauthorized here, before its instant is used
 * anywhere.** That ordering is the point rather than an implementation detail:
 * `architecture/timeline.md:672-684` lists a *timestamp* among the things an
 * unauthorized destination must not leak, so there must be no path that pages
 * around an instant and only afterwards discovers the anchor was refused. An
 * anchor that does not resolve yields no instant at all.
 *
 * **An unresolvable anchor is undefined, never an error.** A destination that
 * was never there, one that is not this reader's to see, and one on a Timeline
 * they may not open are the same answer, because distinguishing them would say
 * something was there.
 */

/** Why a jump was made, as the schema names it. */
export type GraphQLJumpReason =
  | "INSTANT"
  | "MOMENT"
  | "LOCATION"
  | "REAL_WORLD_EVENT"
  | "CAUSAL_RELATIONSHIP"
  | "HISTORICAL_SIGNIFICANCE"
  | "SEARCH_RESULT";

/** What `TimelineAnchorInput` arrives as, once GraphQL has coerced it. */
export interface TimelineAnchorArguments {
  readonly moment?: string | null;
  readonly instant?: Date | null;
  readonly location?: { readonly locationId: string; readonly at?: Date | null } | null;
  readonly realWorldEvent?: {
    readonly realWorldEventId: string;
    readonly at?: Date | null;
  } | null;
  readonly causal?: {
    readonly fromMomentId: string;
    readonly relationshipId: string;
  } | null;
  readonly significance?: {
    readonly startsAt: Date;
    readonly scale: GraphQLScale;
  } | null;
  readonly searchResult?: {
    readonly entityType: GraphQLSearchEntityType;
    readonly entityId: string;
    readonly at?: Date | null;
  } | null;
}

/** Where a jump goes, once the destination has been found and reauthorized. */
export interface ResolvedAnchor {
  readonly instant: Date;
  /** The Moment jumped to, when one was named. Absent for an instant or a place. */
  readonly momentId: string | undefined;
  /**
   * Who recorded it.
   *
   * Carried because their own Timeline is the one Timeline guaranteed to hold
   * it, and is therefore where a jump lands when the Timeline being read does
   * not.
   */
  readonly authorUserId: string | undefined;
  /** Whose history to read. Not always the one asked about. */
  readonly scope: TimelineScopeRef;
  readonly reason: GraphQLJumpReason;
}

/** What kind of thing was found, as the schema names it. */
export type GraphQLSearchEntityType = "MOMENT" | "USER" | "EVENT" | "LOCATION";

/**
 * The kinds, as the schema spells them against the Search index's.
 *
 * `EVENT` rather than `REAL_WORLD_EVENT` because that is what a Search result
 * carries, and an app should hand back what it was given rather than translate.
 */
const ENTITY_TYPES: Record<GraphQLSearchEntityType, SearchEntityType> = {
  MOMENT: "moment",
  USER: "user",
  EVENT: "event",
  LOCATION: "location",
};

/** The scales, as the schema spells them against the contract's. */
const SCALES: Record<GraphQLScale, TimelineScale> = {
  DAY: "day",
  WEEK: "week",
  MONTH: "month",
  YEAR: "year",
  DECADE: "decade",
  CENTURY: "century",
};

/**
 * Which anchor was named, refusing anything but exactly one.
 *
 * @param anchor - What arrived.
 * @returns The single key that was set.
 * @throws {ValidationError} If none was named or more than one was. Refused
 *   rather than resolved by precedence: a request naming two destinations is a
 *   client assembling arguments wrongly, and picking one would send somebody
 *   somewhere they did not ask to go.
 */
function soleAnchor(anchor: TimelineAnchorArguments): keyof TimelineAnchorArguments {
  const named = (
    [
      "moment",
      "instant",
      "location",
      "realWorldEvent",
      "causal",
      "significance",
      "searchResult",
    ] as const
  ).filter((key) => anchor[key] !== undefined && anchor[key] !== null);
  const only = named[0];

  if (only === undefined) {
    throw new ValidationError(
      "A jump needs somewhere to go: a Moment, an instant, a place, an occasion, a relationship, what a span was about, or something you found",
    );
  }

  if (named.length > 1) {
    throw new ValidationError("A jump goes to one destination, not several");
  }

  return only;
}

/**
 * Refuse an instant older than history can be read.
 *
 * @param at - The instant asked for.
 * @returns The same instant.
 * @throws {ValidationError} If it falls before the projection's floor, below
 *   which an instant does not fail but silently becomes 1900.
 */
function withinHistory(at: Date): Date {
  if (at.getTime() < HISTORY_FLOOR.getTime()) {
    throw new ValidationError(
      `History can be read back to ${HISTORY_FLOOR.getUTCFullYear()}; ask for a later instant`,
    );
  }

  return at;
}

/**
 * The same view, read in another Timeline.
 *
 * **The lens does not travel and the filters do not either.** A perspective is
 * something only a person's Timeline has — the contract refuses any other — and
 * a filter narrows within the scope it was written for. The stretch of time
 * does travel, because a range is a claim about history rather than about whose
 * it is.
 *
 * @param view - What was being read.
 * @param scope - Where the jump landed.
 * @returns A view over the destination, keeping only what still means something.
 * @throws {ValidationError} If the result is somehow not a view the contract
 *   admits, which would be this function's own fault rather than the caller's.
 */
function viewFor(view: ViewSpecification, scope: TimelineScopeRef): ViewSpecification {
  if (view.context.type === scope.type && view.context.id === scope.id) {
    return view;
  }

  const parsed = viewSpecificationSchema.safeParse({
    context: { type: scope.type, id: scope.id },
    ...(view.range === undefined ? {} : { range: view.range }),
    limit: view.limit,
    direction: view.direction,
    ...(view.zoom === undefined ? {} : { zoom: view.zoom }),
  });

  if (!parsed.success) {
    throw new ValidationError("That destination is not one a Timeline can be read for");
  }

  return parsed.data;
}

/**
 * Find where a jump goes, and prove the Viewer may go there.
 *
 * @param anchor - How the destination was named.
 * @param view - What was being read when the jump was made.
 * @param facts - Who is asking and whether they are old enough, resolved once
 *   for the request. Not a Timeline eligibility: none of these are Timeline
 *   questions, and the destination's Timeline may not be the one in hand.
 * @param context - Carries the read models each kind of destination lives in.
 * @returns Where to land, or undefined when the destination is not this
 *   reader's to reach — which is deliberately the same answer as one that does
 *   not exist.
 * @throws {ValidationError} If no destination was named, if several were, if an
 *   instant falls before history is held, or if a span was named that does not
 *   begin where its scale says it must.
 */
export async function resolveAnchor(
  anchor: TimelineAnchorArguments,
  view: ViewSpecification,
  facts: { readonly viewerUserId: string; readonly isAdult: boolean },
  context: GraphQLContext,
): Promise<ResolvedAnchor | undefined> {
  const kind = soleAnchor(anchor);

  switch (kind) {
    case "instant": {
      // The only kind that touches no store, and the only one that cannot be
      // refused: an instant is a position, and every position exists.
      return {
        instant: withinHistory(anchor.instant as Date),
        momentId: undefined,
        authorUserId: undefined,
        scope: view.context,
        reason: "INSTANT",
      };
    }

    case "moment":
      return atMoment(anchor.moment as string, view, facts, context, "MOMENT");

    case "causal": {
      const causal = anchor.causal as { fromMomentId: string; relationshipId: string };
      const from = await context.moments.findVisible(
        causal.fromMomentId,
        facts.viewerUserId,
        facts.isAdult,
      );

      if (from === undefined) {
        return undefined;
      }

      const relationship = await context.moments.findRelationship(
        from,
        causal.relationshipId,
        facts.isAdult,
      );

      // **A far end Chronologity has withheld is refused here**, though the
      // relationship list keeps it marked unavailable. A list keeps a chain's
      // shape by admitting the link exists; a landing has no shape to keep, and
      // would disclose an instant and a position instead.
      if (relationship === undefined || relationship.unavailable) {
        return undefined;
      }

      const far =
        relationship.source_moment_id === from.row.moment_id
          ? relationship.target_moment_id
          : relationship.source_moment_id;

      return atMoment(far, view, facts, context, "CAUSAL_RELATIONSHIP");
    }

    case "significance": {
      const asked = anchor.significance as { startsAt: Date; scale: GraphQLScale };
      const scale = SCALES[asked.scale];
      const startsAt = withinHistory(asked.startsAt);

      if (!isSpanStart(scale, startsAt)) {
        throw new ValidationError(`That instant is not where a ${scale} begins`);
      }

      // **The span's own summary, not a new ranking.** Whatever temporal zoom
      // would show as standing for this span is what a jump to it lands on —
      // which is why this discloses nothing zoom does not, and why the rules
      // that make it safe are the ones already tested: readable-only, one per
      // person, and never ordered by anybody's private mark.
      const chosen = await context.representatives.choose(
        { ...view, zoom: scale, range: { kind: "fixed", from: startsAt.toISOString(), to: spanEnd(scale, startsAt).toISOString() } },
        scale,
        facts.viewerUserId,
        facts.isAdult,
      );
      const first = chosen[0];

      return first === undefined
        ? undefined
        : atMoment(first.moment_id, view, facts, context, "HISTORICAL_SIGNIFICANCE");
    }

    case "realWorldEvent":
      return atOccasion(
        anchor.realWorldEvent as { realWorldEventId: string; at?: Date | null },
        facts,
        context,
        "REAL_WORLD_EVENT",
      );

    case "location":
      return atPlace(
        anchor.location as { locationId: string; at?: Date | null },
        view,
        context,
        "LOCATION",
      );

    case "searchResult": {
      const found = anchor.searchResult as {
        entityType: GraphQLSearchEntityType;
        entityId: string;
        at?: Date | null;
      };
      const parsed = identifierSchema.safeParse(found.entityId);

      if (!parsed.success) {
        throw new ValidationError("That is not something that can be found");
      }

      // **Findability first, and the order is the whole argument.** It is the
      // cheapest refusal — one indexed lookup — and it must come before the
      // destination is resolved, because a thing Search would no longer offer
      // must not have its instant computed at all. Same rule as reauthorization,
      // for the same reason `timeline.md:678` gives: a timestamp is one of the
      // things an unreachable destination must not leak.
      //
      // Intrinsic only. Whether *this reader* may see it is asked below, by the
      // same reauthorization every other anchor performs — never by a second
      // copy of the API's Search eligibility, which is the mistake ADR-120 named.
      if (!(await context.searchDocuments.findable(ENTITY_TYPES[found.entityType], parsed.data))) {
        return undefined;
      }

      // **The server works out which kind of destination this is**, rather than
      // an app choosing an anchor and asserting where it came from. That is what
      // earns `SEARCH_RESULT`: the reason names work done here, so it cannot be
      // an echo of something unverified (ADR-145, ADR-148).
      switch (found.entityType) {
        case "MOMENT":
          return atMoment(parsed.data, view, facts, context, "SEARCH_RESULT");

        case "LOCATION":
          return atPlace(
            { locationId: parsed.data, ...(found.at == null ? {} : { at: found.at }) },
            view,
            context,
            "SEARCH_RESULT",
          );

        case "EVENT":
          return atOccasion(
            { realWorldEventId: parsed.data, ...(found.at == null ? {} : { at: found.at }) },
            facts,
            context,
            "SEARCH_RESULT",
          );

        case "USER":
          return atPerson(parsed.data, view, context, "SEARCH_RESULT");
      }
    }
  }
}

/**
 * Land on a Moment, wherever it turns out to live.
 *
 * **One scope rule, for every anchor that names a Moment.** Stay in the Timeline
 * being read when it holds the destination; otherwise land in the destination
 * author's own, which is the one Timeline guaranteed to hold it. Landing at the
 * right instant in a Timeline that does not contain what was asked for would be
 * arriving at the right date in the wrong history.
 *
 * Whether the current scope holds it is not asked here — that costs a query, and
 * the page about to be read answers it for nothing. This names the scope to try
 * first; the composer reissues against the author if the landing did not appear.
 *
 * @param momentId - Which Moment.
 * @param view - What was being read.
 * @param facts - Who is asking.
 * @param context - Carries the Moment read model.
 * @param reason - How the destination came to be named.
 * @returns Where to land, or undefined when it is not this reader's to see.
 */
async function atMoment(
  momentId: string,
  view: ViewSpecification,
  facts: { readonly viewerUserId: string; readonly isAdult: boolean },
  context: GraphQLContext,
  reason: GraphQLJumpReason,
): Promise<ResolvedAnchor | undefined> {
  const moment = await context.moments.findVisible(momentId, facts.viewerUserId, facts.isAdult);

  if (moment === undefined) {
    return undefined;
  }

  return {
    instant: moment.row.occurrence_start,
    momentId,
    authorUserId: moment.row.author_user_id,
    scope: view.context,
    reason,
  };
}


/**
 * Land in an occasion.
 *
 * The one destination carrying an instant of its own: an occasion's start is its
 * own declaration rather than anything derived from the Moments recorded of it.
 *
 * @param asked - Which occasion, and optionally when within it.
 * @param facts - Who is asking.
 * @param context - Carries the occasion read model.
 * @param reason - How the destination came to be named.
 * @returns Where to land, or undefined when no part of it is this reader's to
 *   know about — an occasion's existence is exactly as private as the history
 *   establishing it.
 * @throws {ValidationError} If the instant falls before history is held.
 */
async function atOccasion(
  asked: { readonly realWorldEventId: string; readonly at?: Date | null },
  facts: { readonly viewerUserId: string; readonly isAdult: boolean },
  context: GraphQLContext,
  reason: GraphQLJumpReason,
): Promise<ResolvedAnchor | undefined> {
  const occasion = await context.realWorldEvents.findVisible(
    asked.realWorldEventId,
    facts.viewerUserId,
    facts.isAdult,
  );

  if (occasion === undefined) {
    return undefined;
  }

  return {
    instant: withinHistory(asked.at ?? occasion.occurrence_start),
    momentId: undefined,
    authorUserId: undefined,
    scope: { type: "real_world_event", id: asked.realWorldEventId },
    reason,
  };
}

/**
 * Land in a place.
 *
 * **A place carries no instant**, so with none supplied the jump opens it where
 * its history does.
 *
 * @param asked - Which place, and optionally when.
 * @param view - What was being read.
 * @param context - Carries the Timeline read model and this request's
 *   eligibility.
 * @param reason - How the destination came to be named.
 * @returns Where to land, or undefined when nothing in it is readable — which is
 *   deliberately the same answer as a place that does not exist.
 * @throws {ValidationError} If the instant falls before history is held.
 */
async function atPlace(
  asked: { readonly locationId: string; readonly at?: Date | null },
  view: ViewSpecification,
  context: GraphQLContext,
  reason: GraphQLJumpReason,
): Promise<ResolvedAnchor | undefined> {
  const scope: TimelineScopeRef = { type: "location", id: asked.locationId };

  if (asked.at !== undefined && asked.at !== null) {
    return {
      instant: withinHistory(asked.at),
      momentId: undefined,
      authorUserId: undefined,
      scope,
      reason,
    };
  }

  const newest = await newestIn(scope, view, context);

  return newest === undefined
    ? undefined
    : { instant: newest, momentId: undefined, authorUserId: undefined, scope, reason };
}

/**
 * Land in a person's own history.
 *
 * **A person is not an occurrence**, so like a place they carry no instant of
 * their own and the landing is wherever their history reaches. Deliberately the
 * same shape as a place rather than a second way of solving one problem: it is
 * the destination's own eligibility that decides, which is what makes a person
 * with nothing readable answer exactly as one who does not exist.
 *
 * No `at`, unlike a place. A place is somewhere history happened and asking for
 * a date in it is ordinary; a person is not a stretch of time, and a client
 * wanting their history at a date is asking for a Timeline rather than a jump.
 *
 * @param userId - Whose history.
 * @param view - What was being read.
 * @param context - Carries the Timeline read model and this request's
 *   eligibility.
 * @param reason - How the destination came to be named.
 * @returns Where to land, or undefined when none of their history is this
 *   reader's to see.
 * @throws {ValidationError} If the destination is somehow not one a Timeline can
 *   be read for.
 */
async function atPerson(
  userId: string,
  view: ViewSpecification,
  context: GraphQLContext,
  reason: GraphQLJumpReason,
): Promise<ResolvedAnchor | undefined> {
  const scope: TimelineScopeRef = { type: "person", id: userId };
  const newest = await newestIn(scope, view, context);

  return newest === undefined
    ? undefined
    : { instant: newest, momentId: undefined, authorUserId: undefined, scope, reason };
}

/**
 * When a scope's history most recently reached.
 *
 * One row, read newest-first, **authorized as the destination rather than as the
 * Timeline in hand**. That is the load-bearing part: a scope the reader may not
 * open, one holding nothing they may see, and one that was never there all come
 * back the same way, so no instant is produced for any of them.
 *
 * @param scope - Whose history.
 * @param view - What was being read, which supplies the stretch of time and the
 *   limit but not the lens.
 * @param context - Carries the Timeline read model and this request's
 *   eligibility.
 * @returns The newest readable occurrence, or undefined when there is none.
 * @throws {ValidationError} If the destination is not one a Timeline can be read
 *   for.
 */
async function newestIn(
  scope: TimelineScopeRef,
  view: ViewSpecification,
  context: GraphQLContext,
): Promise<Date | undefined> {
  const destination = viewFor(view, scope);
  const viewer = await context.eligibility.forScope(scope);
  const head = await context.timeline.page(
    { ...destination, limit: 1, direction: "older" },
    viewer,
    undefined,
  );
  const newest = head.rows[0];

  return newest === undefined ? undefined : new Date(`${newest.occurred_at.replace(" ", "T")}Z`);
}

export { viewFor };
