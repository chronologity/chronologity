import type { TimelineEntry as ContractTimelineEntry } from "@chronologity/contracts";
import { ValidationError } from "../../lib/errors/validation-error.js";
import { decodeCursor, encodeCursor, type TimelinePosition } from "./timeline.cursor.js";
import type {
  Direction,
  Scale,
  TimelineBucket,
  TimelineReadRepository,
} from "./timeline.read.repository.js";
import type { TimelineRecord } from "./timeline-row.js";

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

/** How many Moments one page may carry. */
const DEFAULT_LIMIT = 50;
const MAXIMUM_LIMIT = 200;

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
 * Navigating somebody's own history: pages, jumps, and how it is distributed.
 */
export class TimelineService {
  /**
   * Build the service.
   *
   * @param timeline - Where the rows are read from.
   */
  constructor(private readonly timeline: TimelineReadRepository) {}

  /**
   * A page of somebody's own history.
   *
   * @param viewerUserId - Whose history, which is always the Viewer's here.
   * @param request - Where to resume, which way to walk, and how many.
   * @returns The page, and a cursor when there may be more.
   * @throws {ValidationError} If the page size is out of bounds or the cursor
   *   is not one this system issued.
   */
  async page(
    viewerUserId: string,
    request: { cursor?: string | undefined; direction?: Direction | undefined; limit?: number | undefined },
  ): Promise<TimelinePage> {
    const limit = this.pageSize(request.limit);
    const direction = request.direction ?? "older";
    const from = request.cursor === undefined ? undefined : decodeCursor(request.cursor);

    return this.pageFrom(viewerUserId, from, direction, limit);
  }

  /**
   * Where a Timeline opens.
   *
   * @param viewerUserId - Whose history.
   * @returns The newest occurrence, or undefined for somebody with none.
   */
  async head(viewerUserId: string): Promise<TimelineEntry | undefined> {
    const record = await this.timeline.head(viewerUserId);

    return record === undefined ? undefined : present(record);
  }

  /**
   * Jump to a moment in time, and bring back what surrounds it.
   *
   * `timeline.md:601` asks that a jump return the closest valid context so
   * ordinary navigation continues immediately — hence the slices either side
   * rather than a position a client must then page from.
   *
   * @param viewerUserId - Whose history.
   * @param at - The instant asked for, which need not be one anything happened.
   * @param limit - How many Moments either side.
   * @returns Where it landed and the history around it. A Viewer with no
   *   history gets empty pages rather than an error: asking about a time you
   *   recorded nothing is an ordinary thing to do.
   * @throws {ValidationError} If the page size is out of bounds.
   */
  async around(viewerUserId: string, at: Date, limit?: number): Promise<TimelineAround> {
    const size = this.pageSize(limit);
    const nearest = await this.timeline.nearest(viewerUserId, at);

    if (nearest === undefined) {
      return {
        at: undefined,
        older: { moments: [], cursor: undefined, reverseCursor: undefined },
        newer: { moments: [], cursor: undefined, reverseCursor: undefined },
      };
    }

    const position = positionOf(nearest);

    return {
      at: present(nearest),
      older: await this.pageFrom(viewerUserId, position, "older", size),
      newer: await this.pageFrom(viewerUserId, position, "newer", size),
    };
  }

  /**
   * How much history sits in each span.
   *
   * @param viewerUserId - Whose history.
   * @param scale - Year or decade.
   * @returns One bucket per span holding anything, oldest first.
   */
  async buckets(viewerUserId: string, scale: Scale): Promise<readonly TimelineBucket[]> {
    return this.timeline.buckets(viewerUserId, scale);
  }

  /**
   * Read a page and work out whether there may be another.
   *
   * One row beyond the page is fetched and discarded. Asking for `limit + 1`
   * and finding fewer is what distinguishes "there is more" from "that was the
   * end" — the alternative is a cursor on every page and a client discovering
   * the end by receiving nothing, which is a wasted round trip on every
   * Timeline that ends.
   *
   * @param viewerUserId - Whose history.
   * @param from - Where to resume.
   * @param direction - Which way.
   * @param limit - How many the caller asked for.
   * @returns The page.
   */
  private async pageFrom(
    viewerUserId: string,
    from: TimelinePosition | undefined,
    direction: Direction,
    limit: number,
  ): Promise<TimelinePage> {
    const records = await this.timeline.slice(viewerUserId, from, direction, limit + 1);
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
   * Check a requested page size.
   *
   * @param limit - What was asked for, if anything.
   * @returns The size to use.
   * @throws {ValidationError} If it is not a positive whole number within the
   *   ceiling. Bounded because one request must not be able to ask for the
   *   whole of somebody's history.
   */
  private pageSize(limit: number | undefined): number {
    if (limit === undefined) {
      return DEFAULT_LIMIT;
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > MAXIMUM_LIMIT) {
      throw new ValidationError(`A page holds between 1 and ${MAXIMUM_LIMIT} Moments`, {
        field: "limit",
      });
    }

    return limit;
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
function present(record: TimelineRecord): TimelineEntry {
  return {
    momentId: record.moment_id,
    occurredAt: new Date(`${record.occurred_at.replace(" ", "T")}Z`).toISOString(),
    occurrenceEnd: new Date(`${record.occurrence_end.replace(" ", "T")}Z`).toISOString(),
    // Narrowed rather than validated. The projector wrote these from values the
    // contract had already checked, and a Timeline row is not a boundary — the
    // boundary was the request that created the Moment.
    occurrencePrecision: record.occurrence_precision as TimelineEntry["occurrencePrecision"],
    occurrenceOffsetMinutes: record.occurrence_offset_minutes,
    visibility: record.visibility as TimelineEntry["visibility"],
    discoverable: record.discoverable === 1,
  };
}
