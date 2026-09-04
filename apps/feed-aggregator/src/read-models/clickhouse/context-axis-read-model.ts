import type { ClickHouseClient } from "@clickhouse/client";
import {
  asClickHouseDateTime,
  eligible,
  TIMELINE_VERSION,
  type TimelineEligibility,
  type TimelineScopeRef,
} from "@chronologity/timeline-derivation";

/**
 * Moving sideways through history.
 *
 * Horizontal is an axis rather than a list of related things: standing somewhere
 * at some point in time, a reader can always keep going. What relatedness
 * decides is what they reach *first*.
 *
 * So the axis runs in two tiers. **Shared history** first — contexts a Moment
 * belongs to alongside the one being read, which is a fact somebody recorded
 * rather than anything inferred. Then **the same period** — contexts whose own
 * history reaches the time being looked at, which asserts nothing except that
 * both were going on. `timeline.md:112` is explicit that proximity proves no
 * relationship, so the two are told apart in the answer rather than blurred by
 * ordering.
 *
 * **An edge exists for a reader only if the Moment establishing it does.**
 * Eligibility is applied inside both statements, so privacy is the rule the rest
 * of the service already uses rather than a second one written here.
 */

/** The columns a context read selects. */
export interface ContextRow {
  readonly context_type: string;
  readonly context_id: string;
  /** How many Moments this context shares with the anchor. Zero in tier two. */
  readonly shared_moments: number;
  /** The most recent Moment behind it, which both tiers order by. */
  readonly latest: string;
}

/** A page of contexts, and whether the tier continues past it. */
export interface ContextSlice {
  readonly rows: readonly ContextRow[];
  readonly more: boolean;
}

/** Where a tier resumes. */
export interface ContextPosition {
  readonly shared: number;
  readonly latest: Date;
  readonly contextType: string;
  readonly contextId: string;
}

/** The table holding one row per context a Moment belongs to. */
const CONTEXTS = "timeline_moment_contexts";

/**
 * The kinds of context the axis runs through.
 *
 * An **allowlist**, never `!= 'person'`, so a fourth kind the projector learns
 * to write is excluded until somebody decides it belongs — rather than included
 * because nobody remembered to exclude it.
 *
 * People are absent deliberately and permanently. The projector writes a person
 * row for a Moment's author *and one for every accepted participant*, while the
 * eligibility rule tests only the author — so a public Moment would surface its
 * participants as adjacent to the place it happened, asserting who was there.
 * `real-world-events.md:775` refuses to infer attendance from an association,
 * and Moment depth deliberately carries no participants field.
 */
const NAVIGABLE = "('location', 'real_world_event')";

/**
 * Reads the horizontal axis for one Viewer at a time.
 */
export class ContextAxisReadModel {
  /**
   * Build the read model.
   *
   * @param client - The ClickHouse boundary, reading with `final = 1` so a
   *   duplicate awaiting a merge never reaches a caller.
   * @param version - Which projection version to read.
   */
  constructor(
    private readonly client: ClickHouseClient,
    readonly version: string = TIMELINE_VERSION,
  ) {}

  /**
   * Contexts that share a Moment with this one.
   *
   * The anchor side is a prefix scan on the sort key, which is what that key
   * exists for. The neighbour side finds rows by `moment_id`, written as
   * `IN (subquery)` rather than a join because ClickHouse builds a join's right
   * side into memory — so a join here would materialise the table.
   *
   * `GROUP BY` is not for the count. Without it a context sharing twelve Moments
   * would appear twelve times.
   *
   * Eligibility is applied to **both** sides. One would do if the projector's
   * rows for a Moment always agreed — they carry the same visibility and
   * moderation state — but they are separate rows in a `ReplacingMergeTree`,
   * replaced independently, so a partial reprojection can leave them disagreeing
   * for a window. A conjunction denies, which is the right direction, and it
   * costs nothing because those columns are already being read.
   *
   * @param scope - Where the reader is standing.
   * @param viewer - What they may be shown, resolved before any row is read.
   * @param limit - How many to return.
   * @param after - Where to resume, or undefined to start.
   * @returns The page, and whether this tier continues.
   * @throws {Error} If ClickHouse refuses the statement.
   */
  async sharedHistory(
    scope: TimelineScopeRef,
    viewer: TimelineEligibility,
    limit: number,
    after: ContextPosition | undefined,
  ): Promise<ContextSlice> {
    // On an aggregate, so `HAVING` rather than `WHERE`. Written out rather than
    // as a tuple comparison because the directions are mixed: two descending,
    // then one ascending to break the tie.
    const resume =
      after === undefined
        ? ""
        : `HAVING shared_moments < {afterShared: UInt32}
              OR (shared_moments = {afterShared: UInt32} AND latest < {afterLatest: DateTime64(3)})
              OR (shared_moments = {afterShared: UInt32} AND latest = {afterLatest: DateTime64(3)}
                  AND context_id > {afterContextId: String})`;

    return this.read(
      `WITH shared AS (
           SELECT moment_id, occurred_at
             FROM ${CONTEXTS}
            WHERE projection_version = {version: String}
              AND context_type = {contextType: String}
              AND context_id = {contextId: String}
              AND ${eligible(CONTEXTS)}
       )
       SELECT neighbour.context_type AS context_type,
              neighbour.context_id AS context_id,
              toUInt32(count()) AS shared_moments,
              max(neighbour.occurred_at) AS latest
         FROM ${CONTEXTS} AS neighbour
        WHERE neighbour.projection_version = {version: String}
          AND neighbour.context_type IN ${NAVIGABLE}
          AND NOT (neighbour.context_type = {contextType: String}
                   AND neighbour.context_id = {contextId: String})
          -- Lossless partition pruning: every edge runs through a Moment in
          -- \`shared\`, so no edge can exist outside the anchor's own span.
          -- Measured with EXPLAIN rather than assumed.
          AND neighbour.occurred_at BETWEEN (SELECT min(occurred_at) FROM shared)
                                        AND (SELECT max(occurred_at) FROM shared)
          AND neighbour.moment_id IN (SELECT moment_id FROM shared)
          AND ${eligible("neighbour")}
        GROUP BY neighbour.context_type, neighbour.context_id
        ${resume}
        ORDER BY shared_moments DESC, latest DESC, context_id ASC
        LIMIT {limit: UInt32}`,
      scope,
      viewer,
      limit,
      after,
    );
  }

  /**
   * Contexts whose own history reaches the time being looked at.
   *
   * What makes the axis endless. Beyond the contexts sharing history with where
   * somebody is standing, there is always more history that was going on — and
   * this walks backwards through it, which prunes partitions naturally and keeps
   * going for as long as history does.
   *
   * At or before, rather than nearest on either side. Ordering by distance from
   * an instant scans outwards in both directions, prunes badly, and needs a
   * window that widens when a page comes back short — the shape 9C removed from
   * the architecture for good reason.
   *
   * **What this tier cannot see**: the audience list is bounded to the anchor's
   * scope, because an unbounded "every restricted Moment naming me" grows with
   * how many people have ever named somebody. So a context whose only readable
   * Moments are restricted ones naming this reader will not appear here. That
   * under-reports rather than over-reports, which is the safe direction, and
   * widening it would mean the unbounded list the eligibility rule refuses.
   *
   * @param scope - Where the reader is standing, excluded from its own axis.
   * @param viewer - What they may be shown.
   * @param at - The point in time they are looking from.
   * @param limit - How many to return.
   * @param after - Where to resume, or undefined to start this tier.
   * @returns The page, and whether the tier continues.
   * @throws {Error} If ClickHouse refuses the statement.
   */
  async samePeriod(
    scope: TimelineScopeRef,
    viewer: TimelineEligibility,
    at: Date,
    limit: number,
    after: ContextPosition | undefined,
  ): Promise<ContextSlice> {
    const resume =
      after === undefined
        ? ""
        : `HAVING latest < {afterLatest: DateTime64(3)}
              OR (latest = {afterLatest: DateTime64(3)}
                  AND (context_type, context_id) > ({afterContextType: String}, {afterContextId: String}))`;

    return this.read(
      `WITH shared AS (
           SELECT moment_id FROM ${CONTEXTS}
            WHERE projection_version = {version: String}
              AND context_type = {contextType: String}
              AND context_id = {contextId: String}
              AND ${eligible(CONTEXTS)}
       )
       SELECT context_type, context_id, toUInt32(0) AS shared_moments,
              max(occurred_at) AS latest
         FROM ${CONTEXTS}
        WHERE projection_version = {version: String}
          AND context_type IN ${NAVIGABLE}
          AND occurred_at <= {at: DateTime64(3)}
          AND NOT (context_type = {contextType: String} AND context_id = {contextId: String})
          -- Everything the first tier already answered for. Computed rather
          -- than passed in, because excluding only what a page returned would
          -- let a context appear in both tiers.
          AND (context_type, context_id) NOT IN (
              SELECT DISTINCT tier_one.context_type, tier_one.context_id
                FROM ${CONTEXTS} AS tier_one
               WHERE tier_one.projection_version = {version: String}
                 AND tier_one.context_type IN ${NAVIGABLE}
                 AND tier_one.moment_id IN (SELECT moment_id FROM shared)
          )
          AND ${eligible(CONTEXTS)}
        GROUP BY context_type, context_id
        ${resume}
        ORDER BY latest DESC, context_type ASC, context_id ASC
        LIMIT {limit: UInt32}`,
      scope,
      viewer,
      limit,
      after,
      at,
    );
  }

  /**
   * Run a tier and report whether it continues.
   *
   * @param query - The statement, already carrying its own ordering and resume.
   * @param scope - The anchor.
   * @param viewer - What the reader may be shown.
   * @param limit - How many the caller asked for.
   * @param after - Where the tier resumes, bound when present.
   * @param at - The instant tier two reads back from.
   * @returns The rows trimmed to the limit, and whether a probe row came back.
   * @throws {Error} If ClickHouse refuses the statement.
   */
  private async read(
    query: string,
    scope: TimelineScopeRef,
    viewer: TimelineEligibility,
    limit: number,
    after: ContextPosition | undefined,
    at?: Date,
  ): Promise<ContextSlice> {
    const result = await this.client.query({
      query,
      query_params: {
        version: this.version,
        contextType: scope.type,
        contextId: scope.id,
        viewer: viewer.viewerUserId,
        blocked: viewer.blocked,
        audience: viewer.audience,
        isAdult: viewer.isAdult ? 1 : 0,
        // One beyond the page. Never returned; its presence answers whether
        // this tier has more.
        limit: limit + 1,
        ...(at === undefined ? {} : { at: asClickHouseDateTime(at) }),
        ...(after === undefined
          ? {}
          : {
              afterShared: after.shared,
              afterLatest: asClickHouseDateTime(after.latest),
              afterContextType: after.contextType,
              afterContextId: after.contextId,
            }),
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<ContextRow>();

    return { rows: rows.slice(0, limit), more: rows.length > limit };
  }
}
