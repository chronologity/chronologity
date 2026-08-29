import type { DataSource } from "typeorm";

/**
 * What a Viewer may be shown, resolved before any Timeline row is read.
 *
 * The Timeline lives in ClickHouse and the facts that decide eligibility live
 * in PostgreSQL, which cannot be joined. So the facts are gathered first — one
 * round trip — and handed to the ClickHouse query as parameters, where they
 * filter inside the same statement that orders and pages.
 *
 * **Inside, not after.** `search.md:249` draws the line: filter, then order,
 * then paginate, never order, paginate, then filter. Removing withheld rows
 * from a finished page leaks through its size — asking for twenty and receiving
 * four says sixteen things exist — and through the gaps between pages.
 *
 * Three of the four facts fit in a request. The fourth, whether an author is
 * suspended, does not: a Location may have a hundred contributors, and asking
 * PostgreSQL about each would be the join this design exists to avoid. That one
 * lives in ClickHouse as `timeline_suspended_authors`, one row per suspended
 * account, and the query joins it there.
 */

/** What a Viewer's context comes to. */
export interface TimelineEligibility {
  readonly viewerUserId: string;
  /**
   * Accounts whose history this Viewer may not see, in either direction.
   *
   * Both directions, as `privacyPermits` already requires: an asymmetric rule
   * would leave the blocker still reading the history of somebody they wanted
   * nothing to do with, and would let the blocked person infer the Block from
   * results that stopped appearing one way only.
   */
  readonly blocked: readonly string[];
  /**
   * Restricted Moments **within this scope** that name the Viewer.
   *
   * Scoped rather than global, and that is what makes it bounded. "Every Moment
   * naming me" grows with how many people have named me; "restricted Moments at
   * this Location naming me" is bounded by the Location. `moment_audience`
   * carries an index on `(user_id, moment_id)` for precisely this read, and its
   * comment says so.
   */
  readonly audience: readonly string[];
  /**
   * Whether the Viewer is old enough for age-restricted history.
   *
   * Resolved once per request rather than joined per row, as everywhere else.
   * A Viewer whose age cannot be established is not an adult: ambiguous
   * security-sensitive state denies.
   */
  readonly isAdult: boolean;
}

/** Which scope is being read. */
export interface TimelineScopeRef {
  readonly type: "location" | "real_world_event";
  readonly id: string;
}

/**
 * Resolves what a Viewer may be shown, once per request, before any row is read.
 */
export class TimelineEligibilityResolver {
  /**
   * Build the resolver.
   *
   * @param dataSource - PostgreSQL. Read only; nothing here writes.
   * @param adultAgeYears - The age at which age-restricted history opens.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly adultAgeYears: number = 18,
  ) {}

  /**
   * Everything the Timeline query needs to know about this Viewer.
   *
   * @param viewerUserId - Who is asking.
   * @param scope - Which Location or Event they are reading, so the audience
   *   lookup can be bounded by it.
   * @returns The context, with empty lists rather than absent ones — a query
   *   built from an absent list would filter everything rather than nothing,
   *   and the failure would look like an empty Timeline rather than an error.
   */
  async resolve(viewerUserId: string, scope: TimelineScopeRef): Promise<TimelineEligibility> {
    const [blocked, audience, isAdult] = await Promise.all([
      this.blockedAccounts(viewerUserId),
      this.audienceWithin(viewerUserId, scope),
      this.isAdult(viewerUserId),
    ]);

    return { viewerUserId, blocked, audience, isAdult };
  }

  /**
   * Accounts separated from the Viewer by a Block, in either direction.
   *
   * @param viewerUserId - Who is asking.
   * @returns The other party in every Block touching them, each once.
   */
  private async blockedAccounts(viewerUserId: string): Promise<string[]> {
    const rows: { user_id: string }[] = await this.dataSource.query(
      `SELECT blocked_user_id AS user_id FROM user_blocks WHERE blocker_user_id = $1
        UNION
       SELECT blocker_user_id AS user_id FROM user_blocks WHERE blocked_user_id = $1`,
      [viewerUserId],
    );

    return rows.map((row) => row.user_id);
  }

  /**
   * Restricted Moments in this scope that name the Viewer.
   *
   * @param viewerUserId - Who is asking.
   * @param scope - The Location or Event being read.
   * @returns Their identifiers. Bounded by the scope rather than by how many
   *   people have ever named this Viewer.
   */
  private async audienceWithin(
    viewerUserId: string,
    scope: TimelineScopeRef,
  ): Promise<string[]> {
    // Two shapes rather than one query with a branch, because the join differs.
    // The predicate is identical, which is what matters: a rule written twice
    // eventually disagrees with itself, and a join written twice does not.
    const membership =
      scope.type === "location"
        ? `JOIN moment_locations ml ON ml.moment_id = a.moment_id AND ml.location_id = $2`
        : `JOIN moment_real_world_events mre ON mre.moment_id = a.moment_id
             AND mre.real_world_event_id = $2`;

    const rows: { moment_id: string }[] = await this.dataSource.query(
      `SELECT a.moment_id
         FROM moment_audience a
         ${membership}
        WHERE a.user_id = $1`,
      [viewerUserId, scope.id],
    );

    return rows.map((row) => row.moment_id);
  }

  /**
   * Whether the Viewer is old enough for age-restricted history.
   *
   * @param viewerUserId - Who is asking.
   * @returns Whether they are an adult. False when no date of birth is
   *   recorded, which is deny-by-default rather than an optimistic guess.
   */
  private async isAdult(viewerUserId: string): Promise<boolean> {
    const rows: { is_adult: boolean }[] = await this.dataSource.query(
      `SELECT (date_of_birth <= (CURRENT_DATE - make_interval(years => $2))) AS is_adult
         FROM user_restricted_data
        WHERE user_id = $1`,
      [viewerUserId, this.adultAgeYears],
    );

    return rows[0]?.is_adult ?? false;
  }
}
