import type { ClickHouseClient } from "@clickhouse/client";
import { asClickHouseDateTime, TIMELINE_VERSION, type TimelineRecord } from "./timeline-row.js";
import type { TimelinePosition } from "./timeline.cursor.js";

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
}
