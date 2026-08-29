import type { ClickHouseClient } from "@clickhouse/client";
import { asClickHouseDateTime, TIMELINE_VERSION, type TimelineRecord } from "./timeline-row.js";
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
 * @param chosen - A query over the contexts table selecting `moment_id` and
 *   `occurred_at`, already filtered, ordered and limited.
 * @param order - How to order the joined rows, since a join does not preserve
 *   the subquery's order. Qualified with the `moment` alias.
 * @returns The query to run.
 */
function withMoments(chosen: string, order: string): string {
  // Columns named one by one rather than `moment.*`, which ClickHouse returns
  // qualified — `moment.moment_id` — and every reader here expects bare names.
  return `SELECT moment.occurred_at AS occurred_at,
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
 * The condition deciding what a Viewer may be shown in a scope.
 *
 * One fragment, used by every scoped read. `visibleToViewer` is one fragment
 * for Moments and `eligibleForViewer` is one for Search, both for the same
 * reason: a rule written in several places eventually disagrees with itself,
 * and this is the rule that leaks when it does.
 *
 * It reads four parameters the caller must supply — `viewer`, `blocked`,
 * `audience`, `isAdult` — and there is no variant that omits them. A caller who
 * forgot one would otherwise get somebody else's history.
 *
 * The order is the policy's: your own first, then the author, then the Block,
 * then the audience, then age. A Block cannot be outlived by an invitation
 * issued before it.
 *
 * @param alias - The table alias the Timeline rows are read under.
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
   * Where a Timeline opens.
   *
   * The newest *occurrence*, never the newest recording. A Moment added today
   * about 1969 belongs in 1969, and letting it become the head would put
   * somebody at the wrong end of their own history the moment they backfilled
   * anything.
   *
   * @param authorUserId - Whose history.
   * @returns The newest position, or undefined when they have none.
   */
  async head(authorUserId: string): Promise<TimelineRecord | undefined> {
    const result = await this.client.query({
      query: `SELECT * FROM timeline_moments
               WHERE projection_version = {version: String}
                 AND author_user_id = {authorUserId: String}
               ORDER BY occurred_at DESC, moment_id DESC
               LIMIT 1`,
      query_params: { version: this.version, authorUserId },
      format: "JSONEachRow",
    });

    return (await result.json<TimelineRecord>())[0];
  }

  /**
   * A page of history, running in one direction from a position.
   *
   * @param authorUserId - Whose history.
   * @param from - Where to resume, or undefined to start at the appropriate
   *   end for the direction.
   * @param direction - `older` walks back through history, `newer` forwards.
   * @param limit - How many rows at most.
   * @returns The rows, ordered as they were walked — so `older` comes back
   *   newest-first and `newer` oldest-first, each continuing from `from`.
   */
  async slice(
    authorUserId: string,
    from: TimelinePosition | undefined,
    direction: Direction,
    limit: number,
  ): Promise<TimelineRecord[]> {
    const older = direction === "older";

    // The tuple comparison is what makes this keyset paging. Both halves are
    // needed: comparing occurrence alone would skip every Moment sharing an
    // instant with the cursor, and there is no guarantee history has only one
    // thing happening at a time.
    const boundary =
      from === undefined
        ? ""
        : older
          ? `AND (occurred_at, moment_id) < ({at: DateTime64(3)}, {momentId: String})`
          : `AND (occurred_at, moment_id) > ({at: DateTime64(3)}, {momentId: String})`;

    const result = await this.client.query({
      query: `SELECT * FROM timeline_moments
               WHERE projection_version = {version: String}
                 AND author_user_id = {authorUserId: String}
                 ${boundary}
               ORDER BY occurred_at ${older ? "DESC" : "ASC"}, moment_id ${older ? "DESC" : "ASC"}
               LIMIT {limit: UInt32}`,
      query_params: {
        version: this.version,
        authorUserId,
        limit,
        ...(from === undefined
          ? {}
          : { at: asClickHouseDateTime(from.occurredAt), momentId: from.momentId }),
      },
      format: "JSONEachRow",
    });

    return result.json<TimelineRecord>();
  }

  /**
   * The Moment nearest an instant.
   *
   * What a historical jump resolves to. `timeline.md:601` asks that a jump
   * return "the closest valid historical context" so ordinary navigation can
   * continue immediately — so this finds the position, and the caller pages
   * either side of it without a second round trip.
   *
   * @param authorUserId - Whose history.
   * @param at - The instant asked for, which need not be one anything happened.
   * @returns The nearest Moment in either direction, or undefined when they
   *   have no history at all. Ties break towards the earlier, so a jump lands
   *   in the same place every time.
   */
  async nearest(authorUserId: string, at: Date): Promise<TimelineRecord | undefined> {
    const result = await this.client.query({
      query: `SELECT * FROM timeline_moments
               WHERE projection_version = {version: String}
                 AND author_user_id = {authorUserId: String}
               ORDER BY abs(dateDiff('millisecond', occurred_at, {at: DateTime64(3)})) ASC,
                        occurred_at ASC,
                        moment_id ASC
               LIMIT 1`,
      query_params: { version: this.version, authorUserId, at: asClickHouseDateTime(at) },
      format: "JSONEachRow",
    });

    return (await result.json<TimelineRecord>())[0];
  }

  /**
   * How much history sits in each span.
   *
   * What zoomed-out navigation shows instead of Moments. `timeline.md:493`
   * warns that returning every Moment at a broad scale is neither efficient nor
   * usable, and counting belongs in the store holding the rows rather than in
   * an API paging through them to add up.
   *
   * @param authorUserId - Whose history.
   * @param scale - Year or decade.
   * @returns One bucket per span that holds anything, oldest first. Empty spans
   *   are absent rather than zero: a century of silence is not ninety-nine rows
   *   of nothing.
   */
  async buckets(authorUserId: string, scale: Scale): Promise<TimelineBucket[]> {
    // Interpolated rather than parameterised, because it names a function
    // rather than a value — and it comes from a union of two literals rather
    // than from a caller, so there is nothing here to inject.
    //
    // **Not `toStartOfInterval(occurred_at, INTERVAL 10 YEAR)`**, which is the
    // obvious way to write this and is wrong for exactly the history this
    // product is about. That function counts intervals from the epoch, so a
    // date before 1970 wraps: measured against ClickHouse 26.4, the moon
    // landing in July 1969 bucketed to **June 2139**. It is correct from 1970
    // onwards, which is what makes it dangerous — a test written with recent
    // fixtures would pass and the defect would surface as somebody's
    // grandparents appearing in the twenty-second century.
    //
    // Taking the year and rounding it down has no epoch in it. Checked at 1901,
    // 1969 and 2020, which is a century either side of the boundary that breaks.
    // Both scales, not just the decade: `toStartOfYear` fails the same way,
    // turning 1901 into 1970. Anything that reduces a date to a boundary by
    // counting from the epoch is unusable here.
    const years = scale === "decade" ? 10 : 1;
    const bucket = `toDateTime64(concat(toString(intDiv(toYear(occurred_at), ${years}) * ${years}), '-01-01 00:00:00'), 3)`;

    const result = await this.client.query({
      query: `SELECT ${bucket} AS starts_at, count() AS count
                FROM timeline_moments
               WHERE projection_version = {version: String}
                 AND author_user_id = {authorUserId: String}
               GROUP BY starts_at
               ORDER BY starts_at ASC`,
      query_params: { version: this.version, authorUserId },
      format: "JSONEachRow",
    });

    const rows = await result.json<{ starts_at: string; count: string }>();

    return rows.map((row) => ({
      // ClickHouse returns a naive datetime; the projection stores UTC, so it
      // is read back as UTC rather than as whatever this process is set to.
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
   */
  async scopedSlice(
    scope: TimelineScopeRef,
    viewer: TimelineEligibility,
    from: TimelinePosition | undefined,
    direction: Direction,
    limit: number,
  ): Promise<TimelineRecord[]> {
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
        `SELECT moment_id, occurred_at
           FROM timeline_moment_contexts
          WHERE projection_version = {version: String}
            AND context_type = {contextType: String}
            AND context_id = {contextId: String}
            AND ${eligible("timeline_moment_contexts")}
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
        limit,
        ...(from === undefined
          ? {}
          : { at: asClickHouseDateTime(from.occurredAt), momentId: from.momentId }),
      },
      format: "JSONEachRow",
    });

    return result.json<TimelineRecord>();
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
  ): Promise<TimelineRecord | undefined> {
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
   */
  async scopedNearest(
    scope: TimelineScopeRef,
    viewer: TimelineEligibility,
    at: Date,
  ): Promise<TimelineRecord | undefined> {
    const result = await this.client.query({
      query: withMoments(
        `SELECT moment_id, occurred_at
           FROM timeline_moment_contexts
          WHERE projection_version = {version: String}
            AND context_type = {contextType: String}
            AND context_id = {contextId: String}
            AND ${eligible("timeline_moment_contexts")}
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
        at: asClickHouseDateTime(at),
      },
      format: "JSONEachRow",
    });

    return (await result.json<TimelineRecord>())[0];
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
   */
  async scopedBuckets(
    scope: TimelineScopeRef,
    viewer: TimelineEligibility,
    scale: Scale,
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
