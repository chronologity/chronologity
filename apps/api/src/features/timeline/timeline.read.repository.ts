import type { ClickHouseClient } from "@clickhouse/client";
import { narrowingSql, type ViewNarrowing } from "./view.js";
import {
  asClickHouseDateTime,
  TIMELINE_VERSION,
  type TimelineReading,
} from "./timeline-row.js";
import type { TimelinePosition } from "./timeline.cursor.js";
import type { TimelineEligibility, TimelineScopeRef } from "./timeline.eligibility.js";

/**
 * Reading history in the order it happened.
 *
 * Every query here is filtered to one author, and that is this sub-phase's
 * whole authorization story rather than an optimisation. Filtering a Timeline
 * for a Viewer who is not the author means knowing about suspensions, Blocks
 * and audiences — all of which live in PostgreSQL, which ClickHouse cannot
 * join. Somebody's own history needs none of it: the condition is exact, it is
 * applied in the query rather than after it, and no cursor a client invents can
 * widen it.
 *
 * Keyset paging throughout, never offsets. `timeline.md:776` requires it and
 * the product explains why: history grows in the middle, so a photograph
 * uploaded today about 1969 lands between two pages somebody has already seen.
 * An offset taken before that insertion now points a row further along, and
 * paging with it repeats one Moment and skips another.
 */

/** Which way a page runs. */
export type Direction = "older" | "newer";

/** How coarsely history is being viewed. */
export type Scale = "year" | "decade";

/** A count of Moments in one span of time. */
export interface TimelineBucket {
  /** The first instant of the span. */
  readonly startsAt: Date;
  readonly count: number;
}

/**
 * Fill a scope's chosen Moments back out into whole Timeline rows.
 *
 * `timeline_moment_contexts` is an index, not a record: it carries what
 * eligibility and ordering need — when, whose, how visible — and nothing a
 * Moment is presented with. Duplicating the presentation columns into it would
 * mean two rows to keep in step and a correction that could land in one and not
 * the other, so the scope query chooses and pages, and this joins back to
 * `timeline_moments` for the rest.
 *
 * The join follows the limit rather than preceding it, so it touches only the
 * rows being returned.
 *
 * Every chosen query supplies a `readable` column. The scoped reads select a
 * constant 1, because their `WHERE` has already refused everything else; the
 * personal read selects the eligibility rule itself, because it refuses nothing
 * and reports instead. One shape either way, so nothing downstream has to know
 * which family it came from.
 *
 * @param chosen - A query over the contexts table selecting `moment_id`,
 *   `occurred_at` and `readable`, already ordered and limited.
 * @param order - How to order the joined rows, since a join does not preserve
 *   the subquery's order. Qualified with the `moment` alias.
 * @returns The query to run.
 */
function withMoments(chosen: string, order: string): string {
  // Columns named one by one rather than `moment.*`, which ClickHouse returns
  // qualified — `moment.moment_id` — and every reader here expects bare names.
  return `SELECT scoped.readable AS readable,
                 moment.occurred_at AS occurred_at,
                 -- When it was recorded, which orders nothing and answers what
                 -- is new. Declared on the record since the specification
                 -- branch and selected by nothing until now, so the field was
                 -- undefined at runtime while its type promised a string.
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
 * A view that narrows nothing.
 *
 * So a caller with no specification — a rebuild, a test, anything internal —
 * need not invent one.
 */
const NOTHING: ViewNarrowing = { conditions: [], params: {} };

/**
 * The condition deciding what a Viewer may be shown.
 *
 * One fragment, used by every read that filters and by the one that reports.
 * A rule written in several places eventually disagrees with itself, and this
 * is the rule that leaks when it does.
 *
 * It reads four parameters the caller must supply — `viewer`, `blocked`,
 * `audience`, `isAdult` — and there is no variant that omits them. A caller who
 * forgot one would otherwise get somebody else's history.
 *
 * @param alias - The table alias the rows are read under.
 * @returns A SQL condition, true when this Viewer may be shown this row.
 */
function eligible(alias: string): string {
  return `(
    -- Your own history, whatever state it is in. Somebody must be able to
    -- navigate their own past even where nobody else may.
    ${alias}.author_user_id = {viewer: String}
    OR (
      -- Suspended authors, read from the dimension table rather than joined
      -- from PostgreSQL. One row per suspended account, and the newest decision
      -- wins — so reinstating somebody restores their history without touching
      -- a single Moment of it.
      ${alias}.author_user_id NOT IN (
        SELECT user_id FROM timeline_suspended_authors WHERE suspended = 1
      )
      AND NOT has({blocked: Array(String)}, ${alias}.author_user_id)
      AND (
        (
          ${alias}.visibility = 'public'
          AND ${alias}.moderation_state != 'restricted_to_authorized_audience'
        )
        OR has({audience: Array(String)}, ${alias}.moment_id)
      )
      AND (${alias}.moderation_state != 'age_restricted' OR {isAdult: UInt8} = 1)
      -- Hidden from everybody but its author while it stands. The moderation
      -- policy says so of this state and of removal; removal never reaches
      -- ClickHouse, because a removed Moment is refused projection. This one
      -- does reach it, which is what made its absence here a leak rather than a
      -- redundancy: a public Moment taken down pending a decision went on being
      -- shown to strangers at the place it happened.
      --
      -- Outside the visibility branch above rather than inside it. That branch
      -- is satisfied either by being public or by naming the Viewer, so a rule
      -- written inside it would withhold a public Moment and show a restricted
      -- one to the very person it named.
      AND ${alias}.moderation_state != 'temporarily_unavailable'
    )
  )`;
}

/**
 * Reads the Timeline projection, always filtered to one author.
 */
export class TimelineReadRepository {
  /**
   * Build the repository.
   *
   * @param client - The ClickHouse boundary, which reads with `final = 1` so a
   *   duplicate awaiting a merge never reaches a caller.
   * @param version - Which projection version to read, so a rebuild can fill a
   *   new one beside the live one.
   */
  constructor(
    private readonly client: ClickHouseClient,
    private readonly version: string = TIMELINE_VERSION,
  ) {}

  /**
   * Where somebody's own Timeline opens.
   *
   * The newest *occurrence*, never the newest recording. A Moment added today
   * about 1969 belongs in 1969, and letting it become the head would put
   * somebody at the wrong end of their own history the moment they backfilled
   * anything.
   *
   * Read from the person context rather than by author, because a person's
   * Timeline is what they authored **together with** what they agreed they were
   * part of, and only the context knows the second half.
   *
   * @param viewer - Whose history, and what they may see of it.
   * @returns The newest position, or undefined when they have none.
   */
  async ownHead(viewer: TimelineEligibility): Promise<TimelineReading | undefined> {
    return (await this.ownSlice(viewer, undefined, "older", 1))[0];
  }

  /**
   * A page of somebody's own history, running in one direction.
   *
   * **Nothing is filtered.** Everything here is theirs: they recorded it, or
   * they agreed they were part of it. What varies is whether they may read it,
   * which comes back as a column rather than as a reason to withhold the row.
   *
   * That is safe precisely because nothing is filtered — the page is the same
   * size either way, so its size cannot disclose what it does not show, which
   * is the property the eligibility rule exists to protect everywhere else.
   *
   * @param viewer - Whose history, and what they may see of it.
   * @param from - Where to resume, or undefined for the appropriate end.
   * @param direction - `older` walks back through history, `newer` forwards.
   * @param limit - How many rows at most.
   * @returns The rows, each carrying whether it may be read.
   * @param narrowing - What the view narrows by, or nothing when the caller
   *   has no specification. Narrowing never widens: it cannot admit a Moment
   *   eligibility withheld.
   */
  async ownSlice(
    viewer: TimelineEligibility,
    from: TimelinePosition | undefined,
    direction: Direction,
    limit: number,
    narrowing: ViewNarrowing = NOTHING,
  ): Promise<TimelineReading[]> {
    const older = direction === "older";
    const boundary =
      from === undefined
        ? ""
        : older
          ? `AND (occurred_at, moment_id) < ({at: DateTime64(3)}, {momentId: String})`
          : `AND (occurred_at, moment_id) > ({at: DateTime64(3)}, {momentId: String})`;
    const order = `occurred_at ${older ? "DESC" : "ASC"}, moment_id ${older ? "DESC" : "ASC"}`;

    const result = await this.client.query({
      query: withMoments(
        `SELECT moment_id, occurred_at,
                ${eligible("timeline_moment_contexts")} AS readable
           FROM timeline_moment_contexts
          WHERE projection_version = {version: String}
            AND context_type = 'person'
            AND context_id = {viewer: String}
            ${narrowingSql(narrowing)}
            ${boundary}
          ORDER BY ${order}
          LIMIT {limit: UInt32}`,
        `moment.occurred_at ${older ? "DESC" : "ASC"}, moment.moment_id ${older ? "DESC" : "ASC"}`,
      ),
      query_params: {
        version: this.version,
        viewer: viewer.viewerUserId,
        blocked: viewer.blocked,
        audience: viewer.audience,
        isAdult: viewer.isAdult ? 1 : 0,
        ...narrowing.params,
        limit,
        ...(from === undefined
          ? {}
          : { at: asClickHouseDateTime(from.occurredAt), momentId: from.momentId }),
      },
      format: "JSONEachRow",
    });

    return result.json<TimelineReading>();
  }

  /**
   * The Moment nearest an instant on somebody's own Timeline.
   *
   * @param viewer - Whose history, and what they may see of it.
   * @param at - The instant asked for, which need not be one anything happened.
   * @returns The nearest, or undefined when they have no history. Ties break
   *   towards the earlier, so a jump lands in the same place twice.
   * @param narrowing - What the view narrows by, or nothing when the caller
   *   has no specification. Narrowing never widens: it cannot admit a Moment
   *   eligibility withheld.
   */
  async ownNearest(
    viewer: TimelineEligibility,
    at: Date,
    narrowing: ViewNarrowing = NOTHING,
  ): Promise<TimelineReading | undefined> {
    const result = await this.client.query({
      query: withMoments(
        `SELECT moment_id, occurred_at,
                ${eligible("timeline_moment_contexts")} AS readable
           FROM timeline_moment_contexts
          WHERE projection_version = {version: String}
            AND context_type = 'person'
            AND context_id = {viewer: String}
            ${narrowingSql(narrowing)}
          ORDER BY abs(dateDiff('millisecond', occurred_at, {at: DateTime64(3)})) ASC,
                   occurred_at ASC,
                   moment_id ASC
          LIMIT 1`,
        "moment.occurred_at ASC, moment.moment_id ASC",
      ),
      query_params: {
        version: this.version,
        viewer: viewer.viewerUserId,
        blocked: viewer.blocked,
        audience: viewer.audience,
        isAdult: viewer.isAdult ? 1 : 0,
        ...narrowing.params,
        at: asClickHouseDateTime(at),
      },
      format: "JSONEachRow",
    });

    return (await result.json<TimelineReading>())[0];
  }

  /**
   * How somebody's own history is distributed.
   *
   * Counts everything on their Timeline, including Moments they may not read.
   * Those are theirs and paging returns them, redacted — a count that left them
   * out would disagree with the pages beneath it, and somebody scrolling a
   * decade would find Moments the bucket said were not there.
   *
   * The opposite of the rule for a scope, where a count must agree with a
   * *filtered* page, and for the same underlying reason: a count and its page
   * must say the same thing.
   *
   * @param viewerUserId - Whose history.
   * @param scale - Year or decade.
   * @returns One bucket per span holding anything, oldest first.
   * @param narrowing - What the view narrows by, or nothing when the caller
   *   has no specification. Narrowing never widens: it cannot admit a Moment
   *   eligibility withheld.
   */
  async ownBuckets(
    viewerUserId: string,
    scale: Scale,
    narrowing: ViewNarrowing = NOTHING,
  ): Promise<TimelineBucket[]> {
    const years = scale === "decade" ? 10 : 1;
    const bucket = `toDateTime64(concat(toString(intDiv(toYear(occurred_at), ${years}) * ${years}), '-01-01 00:00:00'), 3)`;

    const result = await this.client.query({
      query: `SELECT ${bucket} AS starts_at, count() AS count
                FROM timeline_moment_contexts
               WHERE projection_version = {version: String}
                 AND context_type = 'person'
                 AND context_id = {viewerUserId: String}
                 ${narrowingSql(narrowing)}
               GROUP BY starts_at
               ORDER BY starts_at ASC`,
      query_params: { version: this.version, viewerUserId, ...narrowing.params },
      format: "JSONEachRow",
    });

    const rows = await result.json<{ starts_at: string; count: string }>();

    return rows.map((row) => ({
      startsAt: new Date(`${row.starts_at.replace(" ", "T")}Z`),
      count: Number(row.count),
    }));
  }

  /**
   * A page of a scope's history, filtered to what this Viewer may see.
   *
   * The eligibility condition sits in the `WHERE` clause beside the cursor
   * comparison, so withheld Moments are skipped before the limit is applied. A
   * page of twenty comes back with twenty whenever twenty remain — which is the
   * property that stops the page size itself disclosing what was withheld.
   *
   * @param scope - Which Location or real-world Event.
   * @param viewer - What this Viewer may be shown, resolved beforehand.
   * @param from - Where to resume, or undefined to start at the end the
   *   direction implies.
   * @param direction - `older` walks back through history, `newer` forwards.
   * @param limit - How many rows at most.
   * @returns The rows, ordered as they were walked.
   * @param narrowing - What the view narrows by, or nothing when the caller
   *   has no specification. Narrowing never widens: it cannot admit a Moment
   *   eligibility withheld.
   */
  async scopedSlice(
    scope: TimelineScopeRef,
    viewer: TimelineEligibility,
    from: TimelinePosition | undefined,
    direction: Direction,
    limit: number,
    narrowing: ViewNarrowing = NOTHING,
  ): Promise<TimelineReading[]> {
    const older = direction === "older";
    const boundary =
      from === undefined
        ? ""
        : older
          ? `AND (occurred_at, moment_id) < ({at: DateTime64(3)}, {momentId: String})`
          : `AND (occurred_at, moment_id) > ({at: DateTime64(3)}, {momentId: String})`;

    const order = `occurred_at ${older ? "DESC" : "ASC"}, moment_id ${older ? "DESC" : "ASC"}`;

    const result = await this.client.query({
      query: withMoments(
        `SELECT moment_id, occurred_at, 1 AS readable
           FROM timeline_moment_contexts
          WHERE projection_version = {version: String}
            AND context_type = {contextType: String}
            AND context_id = {contextId: String}
            AND ${eligible("timeline_moment_contexts")}
            ${narrowingSql(narrowing)}
            ${boundary}
          ORDER BY ${order}
          LIMIT {limit: UInt32}`,
        `moment.${older ? "occurred_at DESC" : "occurred_at ASC"}, moment.moment_id ${older ? "DESC" : "ASC"}`,
      ),
      query_params: {
        version: this.version,
        contextType: scope.type,
        contextId: scope.id,
        viewer: viewer.viewerUserId,
        blocked: viewer.blocked,
        audience: viewer.audience,
        isAdult: viewer.isAdult ? 1 : 0,
        ...narrowing.params,
        limit,
        ...(from === undefined
          ? {}
          : { at: asClickHouseDateTime(from.occurredAt), momentId: from.momentId }),
      },
      format: "JSONEachRow",
    });

    return result.json<TimelineReading>();
  }

  /**
   * Where a scope's Timeline opens, for this Viewer.
   *
   * Their newest eligible occurrence rather than the scope's, since a head
   * naming a Moment they may not see would disclose that it exists.
   *
   * @param scope - Which Location or real-world Event.
   * @param viewer - What this Viewer may be shown.
   * @returns The newest eligible row, or undefined when they may see none.
   */
  async scopedHead(
    scope: TimelineScopeRef,
    viewer: TimelineEligibility,
  ): Promise<TimelineReading | undefined> {
    return (await this.scopedSlice(scope, viewer, undefined, "older", 1))[0];
  }

  /**
   * The eligible Moment nearest an instant, within a scope.
   *
   * @param scope - Which Location or real-world Event.
   * @param viewer - What this Viewer may be shown.
   * @param at - The instant asked for, which need not be one anything happened.
   * @returns The nearest eligible Moment, or undefined when they may see none.
   *   Ties break towards the earlier, so a jump lands in the same place twice.
   * @param narrowing - What the view narrows by, or nothing when the caller
   *   has no specification. Narrowing never widens: it cannot admit a Moment
   *   eligibility withheld.
   */
  async scopedNearest(
    scope: TimelineScopeRef,
    viewer: TimelineEligibility,
    at: Date,
    narrowing: ViewNarrowing = NOTHING,
  ): Promise<TimelineReading | undefined> {
    const result = await this.client.query({
      query: withMoments(
        `SELECT moment_id, occurred_at, 1 AS readable
           FROM timeline_moment_contexts
          WHERE projection_version = {version: String}
            AND context_type = {contextType: String}
            AND context_id = {contextId: String}
            AND ${eligible("timeline_moment_contexts")}
            ${narrowingSql(narrowing)}
          ORDER BY abs(dateDiff('millisecond', occurred_at, {at: DateTime64(3)})) ASC,
                   occurred_at ASC,
                   moment_id ASC
          LIMIT 1`,
        "moment.occurred_at ASC, moment.moment_id ASC",
      ),
      query_params: {
        version: this.version,
        contextType: scope.type,
        contextId: scope.id,
        viewer: viewer.viewerUserId,
        blocked: viewer.blocked,
        audience: viewer.audience,
        isAdult: viewer.isAdult ? 1 : 0,
        ...narrowing.params,
        at: asClickHouseDateTime(at),
      },
      format: "JSONEachRow",
    });

    return (await result.json<TimelineReading>())[0];
  }

  /**
   * How a scope's history is distributed, counting only what this Viewer sees.
   *
   * Counts must agree with what paging returns. A bucket saying a decade holds
   * five where paging finds two would disclose three withheld Moments as surely
   * as returning them would.
   *
   * @param scope - Which Location or real-world Event.
   * @param viewer - What this Viewer may be shown.
   * @param scale - Year or decade.
   * @returns One bucket per span holding anything eligible, oldest first.
   * @param narrowing - What the view narrows by, or nothing when the caller
   *   has no specification. Narrowing never widens: it cannot admit a Moment
   *   eligibility withheld.
   */
  async scopedBuckets(
    scope: TimelineScopeRef,
    viewer: TimelineEligibility,
    scale: Scale,
    narrowing: ViewNarrowing = NOTHING,
  ): Promise<TimelineBucket[]> {
    const years = scale === "decade" ? 10 : 1;
    const bucket = `toDateTime64(concat(toString(intDiv(toYear(occurred_at), ${years}) * ${years}), '-01-01 00:00:00'), 3)`;

    const result = await this.client.query({
      query: `SELECT ${bucket} AS starts_at, count() AS count
                FROM timeline_moment_contexts
               WHERE projection_version = {version: String}
                 AND context_type = {contextType: String}
                 AND context_id = {contextId: String}
                 AND ${eligible("timeline_moment_contexts")}
                 ${narrowingSql(narrowing)}
               GROUP BY starts_at
               ORDER BY starts_at ASC`,
      query_params: {
        version: this.version,
        contextType: scope.type,
        contextId: scope.id,
        viewer: viewer.viewerUserId,
        blocked: viewer.blocked,
        audience: viewer.audience,
        isAdult: viewer.isAdult ? 1 : 0,
        ...narrowing.params,
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<{ starts_at: string; count: string }>();

    return rows.map((row) => ({
      startsAt: new Date(`${row.starts_at.replace(" ", "T")}Z`),
      count: Number(row.count),
    }));
  }
}
