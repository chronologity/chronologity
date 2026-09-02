import type {
  ReadableTimelineEntry,
  ViewSpecification,
  TimelineEntry as ContractTimelineEntry,
} from "@chronologity/contracts";
import type {
  TimelineEligibility,
  TimelineEligibilityResolver,
  TimelineScopeRef,
} from "@chronologity/timeline-derivation";
import { ValidationError } from "../../lib/errors/validation-error.js";
import { narrowingFor } from "@chronologity/timeline-derivation";
import { decodeCursor, encodeCursor, type TimelinePosition } from "@chronologity/timeline-derivation";
import type {
  Direction,
  Scale,
  TimelineBucket,
  TimelineReadRepository,
} from "./timeline.read.repository.js";
import type { TimelineReading, TimelineRecord } from "@chronologity/timeline-derivation";

/**
 * Navigating history.
 *
 * The rules the repository should not hold: how large a page may be, where a
 * Timeline opens, and what a jump to a time nothing happened at answers.
 *
 * **Every read here is the Viewer's own history.** Not a simplification to be
 * relaxed casually: reading somebody else's requires suspensions, Blocks and
 * audiences, which live in PostgreSQL while these rows live in ClickHouse.
 * Until that bridge exists the author is the Viewer, the repository applies it
 * in the query, and no cursor a client supplies can widen it.
 */

/** A page of history, and where to continue from in either direction. */
export interface TimelinePage {
  /**
   * Mutable rather than `readonly`, and reluctantly.
   *
   * The contract is what a client is promised, and Zod infers a plain array
   * from it. A `readonly` view here would be the stricter type and would not
   * satisfy the schema the route validates against — so the shape agrees with
   * the contract rather than the contract bending to this.
   */
  readonly moments: TimelineEntry[];
  /**
   * Where the next page in the direction of travel resumes.
   *
   * Absent when history ran out — known rather than guessed, because one row
   * beyond the page is fetched and discarded. A client that keeps asking gets
   * an empty page rather than an error: reaching the end of your own history
   * is not a mistake.
   */
  readonly cursor: string | undefined;
  /**
   * Where a page in the opposite direction resumes.
   *
   * `timeline.md:808` asks that navigation not be asymmetric, and a single
   * cursor makes it exactly that: paging back is a cursor away, while coming
   * forward again means a client holding a position from before it started.
   * This is the other end of the page, so either direction is one request from
   * any page a client holds.
   *
   * Present whenever the page is not empty, and following it may yield nothing
   * — knowing in advance would cost a second query to answer a question a
   * client usually does not ask.
   */
  readonly reverseCursor: string | undefined;
}

/**
 * A Moment as the Timeline presents it.
 *
 * Taken from the contract rather than declared again. Two definitions of one
 * shape drift, and the drift shows up as a route that validates something the
 * service cannot produce.
 */
export type TimelineEntry = ContractTimelineEntry;

/** Where a jump landed, and the history either side of it. */
export interface TimelineAround {
  /** The Moment nearest what was asked for, or undefined if there is none. */
  readonly at: TimelineEntry | undefined;
  readonly older: TimelinePage;
  readonly newer: TimelinePage;
}

/**
 * Navigating history: pages, jumps, and how it is distributed.
 *
 * Two families of method over one store. The unprefixed ones read your own
 * history, where the author is the Viewer and nothing else needs deciding. The
 * `scoped` ones read a Location's or a real-world Event's, written by many
 * people, so they resolve who the Viewer is first and hand that to the query
 * rather than filtering what comes back.
 */
export class TimelineService {
  /**
   * Build the service.
   *
   * @param timeline - Where the rows are read from.
   * @param eligibility - Resolves what a Viewer may see in a shared scope. Not
   *   consulted for a Viewer's own history, which needs nothing from it.
   */
  constructor(
    private readonly timeline: TimelineReadRepository,
    private readonly eligibility: TimelineEligibilityResolver,
  ) {}

  /**
   * Read a page and work out whether there may be another.
   *
   * One row beyond the page is fetched and discarded. Asking for `limit + 1`
   * and finding fewer is what distinguishes "there is more" from "that was the
   * end" — the alternative is a cursor on every page and a client discovering
   * the end by receiving nothing, which is a wasted round trip on every
   * Timeline that ends.
   *
   * @param viewer - Whose history, and what they may see of it. Taken already
   *   resolved rather than resolved here, which is what stops a jump costing
   *   three resolutions: `around` needs one for the anchor and one for each
   *   half, and they are the same one. The scoped path has always worked this
   *   way; this one did not.
   * @param from - Where to resume.
   * @param direction - Which way.
   * @param limit - How many the caller asked for.
   * @returns The page.
   * @param view - The specification, when the page comes from one. Its
   *   narrowing is applied to the query; absent, the page is the whole
   *   context.
   */
  private async pageFrom(
    viewer: TimelineEligibility,
    from: TimelinePosition | undefined,
    direction: Direction,
    limit: number,
    view?: ViewSpecification,
  ): Promise<TimelinePage> {
    const records = await this.timeline.ownSlice(
      viewer,
      from,
      direction,
      limit + 1,
      view === undefined ? undefined : narrowingFor(view, CONTEXTS, this.timeline.version),
    );
    const page = records.slice(0, limit);
    const first = page[0];
    const last = page[page.length - 1];

    return {
      moments: page.map(present),
      cursor:
        records.length > limit && last !== undefined ? encodeCursor(positionOf(last)) : undefined,
      reverseCursor: first === undefined ? undefined : encodeCursor(positionOf(first)),
    };
  }

  /**
   * A scoped page from an already-resolved context.
   *
   * @param scope - Which Location or real-world Event.
   * @param viewer - The already-resolved context.
   * @param from - Where to resume, or undefined to start at the end the
   *   direction implies.
   * @param direction - Which way.
   * @param limit - How many the caller asked for.
   * @returns The page, with a cursor at each end.
   * @param view - The specification, when the page comes from one. Its
   *   narrowing is applied to the query; absent, the page is the whole
   *   context.
   */
  private async scopedPageFrom(
    scope: TimelineScopeRef,
    viewer: TimelineEligibility,
    from: TimelinePosition | undefined,
    direction: Direction,
    limit: number,
    view?: ViewSpecification,
  ): Promise<TimelinePage> {
    if (!viewer.scopeIsOpen) {
      // Indistinguishable from a person with no history, which is the point:
      // refusing would say there is something here to refuse.
      return { moments: [], cursor: undefined, reverseCursor: undefined };
    }

    const records = await this.timeline.scopedSlice(
      scope,
      viewer,
      from,
      direction,
      limit + 1,
      view === undefined ? undefined : narrowingFor(view, CONTEXTS, this.timeline.version),
    );
    const page = records.slice(0, limit);
    const first = page[0];
    const last = page[page.length - 1];

    return {
      moments: page.map(present),
      cursor:
        records.length > limit && last !== undefined ? encodeCursor(positionOf(last)) : undefined,
      reverseCursor: first === undefined ? undefined : encodeCursor(positionOf(first)),
    };
  }

  /**
   * A page of whatever a specification asks for.
   *
   * The entry point that does not care where the request came from: live
   * navigation, a Saved View, a shared link and discovery all describe what they
   * want the same way, which is the whole reason the specification exists.
   *
   * Whose history it is comes from the specification's context rather than from
   * which method was called, so own-history and scoped stop being two surfaces
   * and become one engine with a branch in it.
   *
   * @param viewerUserId - Who is asking. Never taken from the specification: a
   *   saved view is a request and never a grant, so who may see what is decided
   *   from the session rather than from the stored object.
   * @param view - What they are looking at.
   * @returns The page, with a cursor at each end.
   * @throws {ValidationError} If the cursor is not one this system issued.
   */
  async derivePage(viewerUserId: string, view: ViewSpecification): Promise<TimelinePage> {
    const from =
      view.position.cursor === undefined ? undefined : decodeCursor(view.position.cursor);

    if (isOwn(viewerUserId, view)) {
      return this.pageFrom(
        await this.eligibility.resolve(viewerUserId, own(viewerUserId)),
        from,
        view.direction,
        view.limit,
        view,
      );
    }

    const viewer = await this.eligibility.resolve(viewerUserId, view.context);

    return this.scopedPageFrom(view.context, viewer, from, view.direction, view.limit, view);
  }

  /**
   * Where the view opens.
   *
   * A page of one rather than a query of its own: the newest thing a view holds
   * is the first thing it would page to, and two ways of asking could disagree.
   *
   * @param viewerUserId - Who is asking.
   * @param view - What they are looking at.
   * @returns The newest Moment the view holds, or undefined when it holds none.
   */
  async deriveHead(
    viewerUserId: string,
    view: ViewSpecification,
  ): Promise<TimelineEntry | undefined> {
    const page = await this.derivePage(viewerUserId, { ...view, limit: 1, direction: "older" });

    return page.moments[0];
  }

  /**
   * A jump, and the history either side of it.
   *
   * @param viewerUserId - Who is asking.
   * @param view - What they are looking at; its anchor is where to jump to.
   * @returns Where it landed and what surrounds it.
   * @throws {ValidationError} If the view names no instant to jump to.
   */
  async deriveAround(viewerUserId: string, view: ViewSpecification): Promise<TimelineAround> {
    if (view.position.anchoredAt === undefined) {
      throw new ValidationError("A jump needs an instant to jump to", {
        field: "position.anchoredAt",
      });
    }

    const at = new Date(view.position.anchoredAt);
    // Resolved once and reused for both halves. Two resolutions could disagree,
    // and a jump whose halves disagreed about eligibility would be worse than
    // one that was merely slow.
    const viewer = await this.eligibility.resolve(viewerUserId, view.context);
    const narrowing = narrowingFor(view, CONTEXTS, this.timeline.version);

    if (isOwn(viewerUserId, view)) {
      const nearest = await this.timeline.ownNearest(viewer, at, narrowing);

      return this.aroundFrom(nearest, (position, direction) =>
        this.pageFrom(viewer, position, direction, view.limit, view),
      );
    }

    if (!viewer.scopeIsOpen) {
      return EMPTY_AROUND;
    }

    const nearest = await this.timeline.scopedNearest(view.context, viewer, at, narrowing);

    return this.aroundFrom(nearest, (position, direction) =>
      this.scopedPageFrom(view.context, viewer, position, direction, view.limit, view),
    );
  }

  /**
   * How the view's history is distributed.
   *
   * @param viewerUserId - Who is asking.
   * @param view - What they are looking at; its zoom is the scale.
   * @returns One bucket per span holding anything, oldest first.
   */
  async deriveBuckets(
    viewerUserId: string,
    view: ViewSpecification,
  ): Promise<readonly TimelineBucket[]> {
    // A view may ask for a day, which somebody can save and this projection
    // cannot yet count. Answered at the nearest scale it has rather than
    // refusing a view that is otherwise perfectly readable — a saved view
    // failing to open is the outcome worth avoiding.
    const scale: Scale = view.zoom === "decade" ? "decade" : "year";
    const narrowing = narrowingFor(view, CONTEXTS, this.timeline.version);

    if (isOwn(viewerUserId, view)) {
      return this.timeline.ownBuckets(viewerUserId, scale, narrowing);
    }

    const viewer = await this.eligibility.resolve(viewerUserId, view.context);

    return viewer.scopeIsOpen
      ? this.timeline.scopedBuckets(view.context, viewer, scale, narrowing)
      : [];
  }

  /**
   * How much a view has grown since somebody last looked at it.
   *
   * The whole of new-Moment awareness, and deliberately the same derivation
   * everything else here uses — `saved-views.md` requires Saved Views to reuse
   * Timeline semantics rather than grow a second query system beside them, and a
   * count that disagreed with the page it summarises would be worse than no
   * count at all.
   *
   * **New means newly recorded, never newly occurred.** A Moment added today
   * belonging to 1969 is new; putting history back where it happened is the
   * point of the product, so a mark on occurrence time would miss precisely the
   * additions worth surfacing.
   *
   * Never called on the read path. It costs a ClickHouse query, which is why a
   * sweep computes it and a list reads what the sweep left.
   *
   * @param viewerUserId - Who is being told. Always the view's owner: a shared
   *   link carries a specification and never a count.
   * @param view - What they saved.
   * @param since - Count what was recorded after this instant.
   * @param cap - Stop counting here.
   * @param now - Injected so a rolling range resolves against the sweep's clock
   *   rather than the process's, which is what makes that testable.
   * @returns How many, never more than the cap. Zero for a scope they may no
   *   longer open, which is what deriving it would return.
   * @throws {Error} If ClickHouse or PostgreSQL refuses.
   */
  async deriveNewCount(
    viewerUserId: string,
    view: ViewSpecification,
    since: Date,
    cap: number,
    now: Date = new Date(),
  ): Promise<number> {
    const narrowing = narrowingFor(view, CONTEXTS, this.timeline.version, now);

    if (isOwn(viewerUserId, view)) {
      return this.timeline.ownNewCount(viewerUserId, since, cap, narrowing);
    }

    const viewer = await this.eligibility.resolve(viewerUserId, view.context);

    // Suspended, blocked, or a Timeline turned off. Deriving would answer empty,
    // so a badge over it would promise history that opening cannot produce.
    return viewer.scopeIsOpen
      ? this.timeline.scopedNewCount(view.context, viewer, since, cap, narrowing)
      : 0;
  }

  /**
   * Assemble a jump from whichever nearest read found it.
   *
   * @param nearest - Where it landed, or undefined when nothing is there.
   * @param pageFrom - How to read a page either side.
   * @returns The jump.
   */
  private async aroundFrom(
    nearest: TimelineReading | undefined,
    pageFrom: (position: TimelinePosition, direction: Direction) => Promise<TimelinePage>,
  ): Promise<TimelineAround> {
    if (nearest === undefined) {
      return EMPTY_AROUND;
    }

    const position = positionOf(nearest);

    return {
      at: present(nearest),
      older: await pageFrom(position, "older"),
      newer: await pageFrom(position, "newer"),
    };
  }

}

/**
 * The position a stored row occupies.
 *
 * @param record - The row.
 * @returns Its place in the sort tuple.
 */
function positionOf(record: TimelineRecord): TimelinePosition {
  // Stored as a naive UTC datetime; read back as UTC rather than as whatever
  // this process happens to be set to.
  return {
    occurredAt: new Date(`${record.occurred_at.replace(" ", "T")}Z`),
    momentId: record.moment_id,
  };
}

/**
 * A stored row as a client sees it.
 *
 * @param record - The row.
 * @returns What the Timeline presents, which carries no author: this sub-phase
 *   returns only the Viewer's own history, so naming them on every row would
 *   be repeating the request back.
 */
function present(record: TimelineReading): TimelineEntry {
  if (record.readable === 0) {
    // Everything but when it happened is withheld, including the UTC offset:
    // that is a statement about where somebody was rather than when, and this
    // person was told the occurrence time and nothing else when they were asked.
    return {
      readable: false,
      momentId: record.moment_id,
      occurredAt: new Date(`${record.occurred_at.replace(" ", "T")}Z`).toISOString(),
      occurrenceEnd: new Date(`${record.occurrence_end.replace(" ", "T")}Z`).toISOString(),
      occurrencePrecision:
        record.occurrence_precision as ReadableTimelineEntry["occurrencePrecision"],
    };
  }

  return {
    readable: true,
    momentId: record.moment_id,
    occurredAt: new Date(`${record.occurred_at.replace(" ", "T")}Z`).toISOString(),
    occurrenceEnd: new Date(`${record.occurrence_end.replace(" ", "T")}Z`).toISOString(),
    // Narrowed rather than validated. The projector wrote these from values the
    // contract had already checked, and a Timeline row is not a boundary — the
    // boundary was the request that created the Moment.
    occurrencePrecision:
      record.occurrence_precision as ReadableTimelineEntry["occurrencePrecision"],
    occurrenceOffsetMinutes: record.occurrence_offset_minutes,
    visibility: record.visibility as ReadableTimelineEntry["visibility"],
    discoverable: record.discoverable === 1,
  };
}

/**
 * Somebody's own Timeline, as a scope.
 *
 * A person is the third kind of scope, after a Location and a real-world Event,
 * and their own reading of it is the one case that filters nothing: everything
 * there is theirs, whether they recorded it or agreed they were part of it.
 *
 * @param userId - Whose.
 * @returns The scope reference the resolver takes.
 */
function own(userId: string): TimelineScopeRef {
  return { type: "person", id: userId };
}

/** The table every narrowing is written against. */
const CONTEXTS = "timeline_moment_contexts";

/** A jump that found nothing. */
const EMPTY_AROUND: TimelineAround = {
  at: undefined,
  older: { moments: [], cursor: undefined, reverseCursor: undefined },
  newer: { moments: [], cursor: undefined, reverseCursor: undefined },
};

/**
 * Whether a view is somebody reading their own history.
 *
 * The one case that reports eligibility rather than filtering on it, because
 * everything on their Timeline is theirs. Decided from the specification's
 * context rather than from which route was called, which is what lets two
 * surfaces be one engine.
 *
 * @param viewerUserId - Who is asking.
 * @param view - What they are looking at.
 * @returns Whether the view is their own history.
 */
function isOwn(viewerUserId: string, view: ViewSpecification): boolean {
  return view.context.type === "person" && view.context.id === viewerUserId;
}
