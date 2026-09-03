import {
  viewSpecificationSchema,
  type ViewContextType,
  type ViewPerspective,
  type ViewSpecification,
} from "@chronologity/contracts";
import type { TimelinePosition, TimelineScopeRef } from "@chronologity/timeline-derivation";
import { ValidationError } from "../../errors/aggregator-error.js";

/**
 * Turning GraphQL arguments into the object the derivation engine takes.
 *
 * A View Specification is what a Timeline request *is* — a context, a lens, a
 * stretch of time, a page — and it is the same object whether it arrived from
 * live navigation, a Saved View or a shared link. This translates one arrival
 * into it and hands the result to the contract's own schema, so every rule the
 * contract already enforces applies here without being restated.
 *
 * That reuse is the point rather than an economy. The schema is strict, and its
 * strictness runs one way on purpose: an unrecognised field is refused rather
 * than dropped, because a view asking to be narrowed that opened unnarrowed
 * would show its reader more history than they asked for. Writing a second
 * validation for GraphQL would be writing a second place for that to regress.
 *
 * Two things the contract cannot supply are owed here. GraphQL enum values are
 * `SCREAMING_CASE` and the contract's are lowercase; and a connection describes
 * where a reader is with `first`/`after` and `last`/`before`, which have to
 * become a direction and a position.
 */

/** A scope as the schema names it. */
export type GraphQLScopeType = "PERSON" | "LOCATION" | "REAL_WORLD_EVENT";

/** A lens as the schema names it. */
export type GraphQLPerspective = "ALL" | "AUTHORED" | "PARTICIPATED";

/** A rolling window's unit as the schema names it. */
export type GraphQLRollingUnit = "DAY" | "MONTH" | "YEAR";

/**
 * The schema's enum values against the contract's.
 *
 * Written out rather than lower-cased, so that adding a kind of scope to either
 * side fails to compile instead of silently producing a context nothing holds.
 */
const CONTEXT_TYPES: Record<GraphQLScopeType, ViewContextType> = {
  PERSON: "person",
  LOCATION: "location",
  REAL_WORLD_EVENT: "real_world_event",
};

const PERSPECTIVES: Record<GraphQLPerspective, ViewPerspective> = {
  ALL: "all",
  AUTHORED: "authored",
  PARTICIPATED: "participated",
};

const ROLLING_UNITS: Record<GraphQLRollingUnit, "day" | "month" | "year"> = {
  DAY: "day",
  MONTH: "month",
  YEAR: "year",
};

/** What `TimelineViewInput` arrives as, once GraphQL has coerced it. */
export interface TimelineViewArguments {
  readonly scope: { readonly type: GraphQLScopeType; readonly id: string };
  readonly perspective?: GraphQLPerspective | null;
  readonly filters?: {
    readonly authorUserId?: string | null;
    readonly locationId?: string | null;
    readonly realWorldEventId?: string | null;
  } | null;
  readonly range?: {
    readonly fixed?: { readonly from: Date; readonly to: Date } | null;
    readonly rolling?: { readonly unit: GraphQLRollingUnit; readonly count: number } | null;
  } | null;
}

/**
 * Where in history the reader is, in the connection's vocabulary.
 *
 * Cursors arrive already decoded: the `Cursor` scalar reads them at the
 * boundary, which is where an untrusted string belongs, so a tampered one is
 * refused before any of this runs.
 */
export interface PagingArguments {
  readonly first?: number | null;
  readonly after?: TimelinePosition | null;
  readonly last?: number | null;
  readonly before?: TimelinePosition | null;
}

/**
 * A request, as the engine takes it.
 *
 * The position is beside the specification rather than inside it. The
 * specification carries `position.cursor` as an opaque *string*, which is the
 * right shape for a Saved View — something stored and reopened — and the wrong
 * one here, where the scalar has already decoded it: putting it back would mean
 * re-encoding a position we hold so that something further down could decode it
 * again.
 */
export interface TimelineRequest {
  readonly view: ViewSpecification;
  /** Where to resume, or undefined to start at the end the direction implies. */
  readonly from: TimelinePosition | undefined;
}

/**
 * Assemble a specification from what a client asked for.
 *
 * @param view - The view arguments: whose history, which lens, what narrowing.
 * @param paging - Where the reader is and how much they want. Absent entirely
 *   for a request that opens the Timeline at its head.
 * @returns The specification and the position to resume from.
 * @throws {ValidationError} If both ends of a page are asked for at once, if a
 *   range is neither fixed nor rolling or is both, or if the combination is not
 *   a view the contract admits — a lens only a person has asked of a place, a
 *   filter naming the same kind of thing as the scope, or a page larger than
 *   the ceiling.
 */
export function specificationFor(
  view: TimelineViewArguments,
  paging: PagingArguments = {},
): TimelineRequest {
  const first = paging.first ?? undefined;
  const after = paging.after ?? undefined;
  const last = paging.last ?? undefined;
  const before = paging.before ?? undefined;

  // One pair or the other. Refused rather than resolved by precedence: a
  // request naming both ends is likelier a client assembling arguments wrongly
  // than somebody who meant one of them, and guessing which would page through
  // the wrong half of somebody's history without saying so.
  if ((first !== undefined || after !== undefined) && (last !== undefined || before !== undefined)) {
    throw new ValidationError(
      "Page towards the past with first and after, or towards the present with last and before, but not both",
    );
  }

  // A Timeline runs newest first, so walking forward through the connection is
  // walking back through history.
  const backward = last !== undefined || before !== undefined;
  const limit = backward ? last : first;
  const from = backward ? before : after;
  const filters = view.filters ?? undefined;
  const authorUserId = filters?.authorUserId ?? undefined;
  const locationId = filters?.locationId ?? undefined;
  const realWorldEventId = filters?.realWorldEventId ?? undefined;
  const range = rangeFor(view.range ?? undefined);

  const parsed = viewSpecificationSchema.safeParse({
    context: { type: CONTEXT_TYPES[view.scope.type], id: view.scope.id },
    perspective: PERSPECTIVES[view.perspective ?? "ALL"],
    filters: {
      ...(authorUserId === undefined ? {} : { authorUserId }),
      ...(locationId === undefined ? {} : { locationId }),
      ...(realWorldEventId === undefined ? {} : { realWorldEventId }),
    },
    ...(range === undefined ? {} : { range }),
    ...(limit === undefined ? {} : { limit }),
    direction: backward ? "newer" : "older",
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];

    throw new ValidationError(issue?.message ?? "That is not a usable view");
  }

  return { view: parsed.data, from };
}

/**
 * Read the stretch of history a request names.
 *
 * @param range - What arrived, or undefined when the request named none.
 * @returns The range as the specification holds it, or undefined for the whole
 *   of history. A rolling range stays a *definition* — the unit and the count,
 *   never the dates they resolve to — so that "the last thirty days" goes on
 *   meaning the thirty days before whenever it is next asked.
 * @throws {ValidationError} If it names both kinds or neither.
 */
function rangeFor(
  range: NonNullable<TimelineViewArguments["range"]> | undefined,
): ViewSpecification["range"] | undefined {
  if (range === undefined) {
    return undefined;
  }

  const fixed = range.fixed ?? undefined;
  const rolling = range.rolling ?? undefined;

  if (fixed !== undefined && rolling !== undefined) {
    throw new ValidationError("A range is a fixed span or a rolling one, not both");
  }

  if (fixed !== undefined) {
    // Back to strings, which is what the specification holds: it is an object
    // that will be stored and reopened, and a `Date` is not something that
    // survives being written down.
    return { kind: "fixed", from: fixed.from.toISOString(), to: fixed.to.toISOString() };
  }

  if (rolling !== undefined) {
    return { kind: "rolling", unit: ROLLING_UNITS[rolling.unit], count: rolling.count };
  }

  // A range naming no stretch of time narrows nothing, which is what leaving it
  // out already means. Refused rather than ignored: it is likelier a client
  // dropping a field than somebody asking for the whole of history the long way.
  throw new ValidationError("A range needs a stretch of time: a fixed span or a rolling one");
}

/**
 * Which scope a specification names.
 *
 * @param context - The specification's context.
 * @returns The scope reference eligibility is resolved for. The two vocabularies
 *   are the same by construction, which is why this is a rename rather than a
 *   translation — and why it is one function rather than a map that could fall
 *   out of step with either side.
 */
export function scopeOf(context: {
  type: TimelineScopeRef["type"];
  id: string;
}): TimelineScopeRef {
  return { type: context.type, id: context.id };
}
