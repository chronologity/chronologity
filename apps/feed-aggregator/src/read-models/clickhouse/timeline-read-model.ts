import type { TimelineScale, ViewSpecification } from "@chronologity/contracts";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  asClickHouseDateTime,
  boundaryCondition,
  clickHouseSpanStart,
  eligible,
  instantBoundary,
  narrowingFor,
  narrowingSql,
  orderFor,
  TIMELINE_VERSION,
  type TimelineEligibility,
  type TimelinePosition,
  type TimelineReading,
} from "@chronologity/timeline-derivation";
import { withSpan } from "../../observability/tracing.js";

/**
 * Reading history in the order it happened.
 *
 * The aggregator's own statements over the projection the API writes. ADR-138
 * shares what must not exist twice — the eligibility rule, the cursor format,
 * the translation from a specification to filters — and leaves each application
 * its own queries, because their shapes genuinely differ: the API returns REST
 * pages and counts what a Saved View has gained, and this returns connections.
 *
 * Keyset paging throughout, never offsets. `timeline.md:776` requires it and
 * the reason is the product rather than performance: history grows in the
 * middle, so a photograph uploaded today about 1969 lands between two pages
 * somebody has already seen, and an offset taken before that insertion now
 * points a row further along.
 *
 * **Eligibility is applied inside the statement, before the limit.** Nothing
 * here is removed after the fact, which is what makes a page come back full
 * whenever history holds that many Moments — and it is why this service does no
 * over-fetching. Filtering a finished page leaks through its size: asking for
 * twenty and receiving four says sixteen things exist.
 */

/** The table carrying membership and the columns eligibility is decided from. */
const CONTEXTS = "timeline_moment_contexts";

/**
 * A page of rows, and whether history continues past its far end.
 *
 * The `more` flag is decided here rather than by a caller, because it is a
 * property of the statement: one row beyond the page is asked for and never
 * returned, and its presence is the difference between "there is more" and
 * "that was the end". The alternative is a cursor on every page and a client
 * discovering the end by receiving nothing, which is a wasted round trip on
 * every Timeline that ends.
 */
/**
 * Where a page begins.
 *
 * Two shapes, because a page begins in two genuinely different ways. **Resuming**
 * from a cursor names a row and must exclude it, or the next page repeats the
 * last. **Landing** names an instant that need not be one anything happened at,
 * and must include everything sharing it — an instant cannot split Moments that
 * occurred at the same time, because it names none of them.
 *
 * One type rather than two parameters so that a caller cannot supply an instant
 * and an identifier that disagree, and so the statement binds exactly the
 * parameters its condition names.
 */
export type TimelineBoundary =
  | {
      readonly kind: "position";
      readonly position: TimelinePosition;
      /** Whether the named row is itself part of the page. False for a cursor. */
      readonly inclusive: boolean;
    }
  | { readonly kind: "instant"; readonly at: Date };

/** How much history one span holds. */
export interface BucketRow {
  /** The instant the span begins, as ClickHouse renders a naive DateTime64. */
  readonly starts_at: string;
  readonly count: number;
}

export interface TimelineSlice {
  /** At most the limit the view asked for, in the order they were walked. */
  readonly rows: readonly TimelineReading[];
  /** Whether the probe row came back. */
  readonly more: boolean;
}

/**
 * Fill a scope's chosen Moments back out into whole Timeline rows.
 *
 * `timeline_moment_contexts` is an index rather than a record: it carries what
 * ordering and eligibility need and nothing a Moment is presented with. So the
 * inner query chooses and pages, and this joins back to `timeline_moments` for
 * the rest — after the limit, so the join touches only the rows being returned.
 *
 * Every chosen query supplies a `readable` column. A scoped read selects a
 * constant 1, because its `WHERE` has already refused everything else; a
 * person's own read selects the eligibility rule itself, because it refuses
 * nothing and reports instead. One shape either way, so nothing downstream has
 * to know which it came from.
 *
 * @param chosen - A query over the contexts table selecting `moment_id`,
 *   `occurred_at` and `readable`, already ordered and limited.
 * @param order - How to order the joined rows, qualified with the `moment`
 *   alias, since a join does not preserve the subquery's order.
 * @returns The query to run.
 */
function withMoments(chosen: string, order: string): string {
  // Named one by one rather than `moment.*`, which ClickHouse returns qualified
  // — `moment.moment_id` — and every reader here expects bare names.
  return `SELECT scoped.readable AS readable,
                 moment.occurred_at AS occurred_at,
                 moment.recorded_at AS recorded_at,
                 moment.moment_id AS moment_id,
                 moment.author_user_id AS author_user_id,
                 moment.projected_at AS projected_at,
                 moment.occurrence_end AS occurrence_end,
                 moment.occurrence_precision AS occurrence_precision,
                 moment.occurrence_offset_minutes AS occurrence_offset_minutes,
                 moment.visibility AS visibility,
                 moment.moderation_state AS moderation_state,
                 moment.discoverable AS discoverable,
                 moment.projection_version AS projection_version
            FROM (${chosen}) AS scoped
           INNER JOIN timeline_moments AS moment
              ON moment.moment_id = scoped.moment_id
             AND moment.projection_version = {version: String}
           ORDER BY ${order}`;
}

/**
 * Reads the Timeline projection for one Viewer at a time.
 */
export class TimelineReadModel {
  /**
   * Build the read model.
   *
   * @param client - The ClickHouse boundary, which reads with `final = 1` so a
   *   duplicate awaiting a merge never reaches a caller.
   * @param version - Which projection version to read, so a rebuild can fill a
   *   new one beside the live one.
   */
  constructor(
    private readonly client: ClickHouseClient,
    readonly version: string = TIMELINE_VERSION,
  ) {}

  /**
   * A page of whatever the view asks for.
   *
   * Two statements behind one method, and the branch is the asymmetry the
   * product requires rather than an optimisation.
   *
   * **Somebody's own Timeline reports rather than filters.** Everything on it is
   * theirs — they recorded it, or they agreed they were part of it — so nothing
   * is removed and whether each row may be *read* comes back as a column. That
   * is safe precisely because nothing is removed: the page is the same size
   * either way, so its size cannot disclose what it does not show.
   *
   * **Every other Timeline filters.** A Moment somebody may not see is absent,
   * because its existence is not theirs to know.
   *
   * @param view - What is being read: the scope, the lens, the narrowing, which
   *   way the page runs and how large it is.
   * @param viewer - What this Viewer may be shown, resolved before any row is
   *   read. Never taken from the view: a stored view is a request, never a
   *   grant.
   * @param from - Where the page begins: a position to resume past, a position
   *   to land on, or an instant to land at. Undefined starts at the end the
   *   direction implies.
   * @returns The rows, and whether history continues past them.
   * @throws {Error} If ClickHouse refuses the statement.
   */
  async page(
    view: ViewSpecification,
    viewer: TimelineEligibility,
    from: TimelineBoundary | undefined,
  ): Promise<TimelineSlice> {
    const own = view.context.type === "person" && view.context.id === viewer.viewerUserId;

    // A Timeline its owner has closed answers empty, exactly as one belonging to
    // somebody with no history does. Asked here rather than filtered later: the
    // statement would return nothing anyway, and not sending it saves a query
    // for an answer already known.
    if (!own && !viewer.scopeIsOpen) {
      return { rows: [], more: false };
    }

    const narrowing = narrowingFor(view, CONTEXTS, this.version);
    const boundary =
      from === undefined
        ? ""
        : from.kind === "instant"
          ? instantBoundary(view.direction)
          : boundaryCondition(view.direction, from.inclusive);
    const membership = own
      ? `AND context_type = 'person'
         AND context_id = {viewer: String}`
      : `AND context_type = {contextType: String}
         AND context_id = {contextId: String}
         AND ${eligible(CONTEXTS)}`;

    const result = await withSpan(
      "query timeline (ClickHouse)",
      async () =>
        this.client.query({
          query: withMoments(
            `SELECT moment_id, occurred_at,
                ${own ? eligible(CONTEXTS) : "1"} AS readable
           FROM ${CONTEXTS}
          WHERE projection_version = {version: String}
            ${membership}
            ${narrowingSql(narrowing)}
            ${boundary}
          ORDER BY ${orderFor(view.direction)}
          LIMIT {limit: UInt32}`,
            orderFor(view.direction, "moment"),
          ),
          query_params: {
            version: this.version,
            viewer: viewer.viewerUserId,
            blocked: viewer.blocked,
            audience: viewer.audience,
            isAdult: viewer.isAdult ? 1 : 0,
            ...(own ? {} : { contextType: view.context.type, contextId: view.context.id }),
            ...narrowing.params,
            // One beyond the page. Never returned; its presence is how the far side
            // of `pageInfo` is answered without a second count.
            limit: view.limit + 1,
            ...(from === undefined
              ? {}
              : from.kind === "instant"
                ? { at: asClickHouseDateTime(from.at) }
                : {
                    at: asClickHouseDateTime(from.position.occurredAt),
                    momentId: from.position.momentId,
                  }),
          },
          format: "JSONEachRow",
        }),
      // Bounded dimensions only. The scope's identifier and the reader's are
      // what make a metric useless and a trace private (`observability.md:410`);
      // which axis, which way and how far are what a slow read is explained by.
      {
        "chronologity.scope_type": view.context.type,
        "chronologity.direction": view.direction,
        "chronologity.limit": view.limit,
      },
    );

    const rows = await result.json<TimelineReading>();

    return { rows: rows.slice(0, view.limit), more: rows.length > view.limit };
  }

  /**
   * How much history each span of a stretch holds.
   *
   * **Spans holding nothing are absent rather than zero.** A century of silence
   * is not a hundred rows of nothing, and a client knows the scale and the
   * interval it asked for, so it can draw the gaps itself. Emitting them would
   * make the answer's size a function of the range rather than of the history.
   *
   * The same own-versus-scoped asymmetry as `page`, and for the same reason:
   * `projections.md` requires that a count and the page it summarises agree.
   * Somebody's own count includes what they may not read, because paging their
   * own Timeline returns those rows redacted rather than removing them; every
   * other count excludes what the Viewer may not see, because paging would too.
   * A count that disagreed with its page would either promise history that never
   * arrives or hide history that does.
   *
   * The stretch is not a parameter. It is already on the view as a fixed range,
   * pinned when the request was assembled, so that this and the read choosing
   * representatives are asked about exactly the same instants.
   *
   * @param view - What is being read, carrying the resolved range it covers.
   * @param viewer - What this Viewer may be shown, resolved before any row is
   *   read.
   * @param scale - How coarsely to group. Bucketed by the shared generator, so
   *   these boundaries are the ones the representative read finds too.
   * @returns One row per span holding anything, oldest first.
   * @throws {Error} If ClickHouse refuses the statement.
   */
  async buckets(
    view: ViewSpecification,
    viewer: TimelineEligibility,
    scale: TimelineScale,
  ): Promise<readonly BucketRow[]> {
    const own = view.context.type === "person" && view.context.id === viewer.viewerUserId;

    if (!own && !viewer.scopeIsOpen) {
      return [];
    }

    const narrowing = narrowingFor(view, CONTEXTS, this.version);
    const membership = own
      ? `AND context_type = 'person'
         AND context_id = {viewer: String}`
      : `AND context_type = {contextType: String}
         AND context_id = {contextId: String}
         AND ${eligible(CONTEXTS)}`;

    const result = await this.client.query({
      query: `SELECT ${clickHouseSpanStart(scale, "occurred_at")} AS starts_at,
                     toUInt32(count()) AS count
                FROM ${CONTEXTS}
               WHERE projection_version = {version: String}
                 ${membership}
                 ${narrowingSql(narrowing)}
               GROUP BY starts_at
               ORDER BY starts_at ASC`,
      query_params: {
        version: this.version,
        viewer: viewer.viewerUserId,
        blocked: viewer.blocked,
        audience: viewer.audience,
        isAdult: viewer.isAdult ? 1 : 0,
        ...(own ? {} : { contextType: view.context.type, contextId: view.context.id }),
        ...narrowing.params,
      },
      format: "JSONEachRow",
    });

    return await result.json<BucketRow>();
  }
}
