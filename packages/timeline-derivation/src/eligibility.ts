/**
 * What a Viewer may be shown, resolved before any Timeline row is read.
 *
 * The Timeline lives in ClickHouse and the facts that decide eligibility live
 * in PostgreSQL, which cannot be joined. So the facts are gathered first and
 * handed to the ClickHouse query as parameters, where they filter inside the
 * same statement that orders and pages. Three of them are gathered together and
 * the fourth needs the third, so it is two round trips rather than the one an
 * earlier version of this sentence claimed.
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

/**
 * Somewhere to send a PostgreSQL statement.
 *
 * The narrowest thing this package needs, declared rather than imported so that
 * nothing here depends on a particular client. Both applications already
 * satisfy it: TypeORM's `DataSource` has exactly this method, and a `pg.Pool`
 * is one small wrapper away.
 *
 * Read only by convention rather than by type. The statements below are the
 * only ones this package issues and every one of them is a `SELECT`; the
 * credential a deployment issues is what enforces it.
 */
export interface Queryable {
  query<Row>(sql: string, parameters?: readonly unknown[]): Promise<Row[]>;
}

/**
 * The condition deciding what a Viewer may be shown.
 *
 * The security rule, and the reason this package exists. It is used by every
 * Timeline read that filters and by the one that reports, in both applications
 * — and a rule written in several places eventually disagrees with itself.
 * This is the rule that leaks when it does, so there is one copy of it.
 *
 * It reads four parameters the caller must supply — `viewer`, `blocked`,
 * `audience`, `isAdult` — and there is no variant that omits them. A caller who
 * forgot one would otherwise get somebody else's history.
 *
 * @param alias - The table alias the rows are read under.
 * @returns A ClickHouse condition, true when this Viewer may be shown this row.
 */
export function eligible(alias: string): string {
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
  /**
   * Whether this Viewer may open this scope at all.
   *
   * False only for a person's Timeline, and for reasons the per-row rule cannot
   * express. That rule tests suspension and Blocks against a Moment's *author*,
   * but a person's Timeline also carries Moments authored by other people that
   * they merely took part in — so a suspended person's participations would go
   * on being shown under their name, and blocking somebody would not hide
   * theirs.
   *
   * A fact about the scope rather than about any row, resolved once here.
   * Nobody's own Timeline is ever closed to them: a suspended person still
   * navigates their own past, which is also what makes an appeal possible.
   */
  readonly scopeIsOpen: boolean;
}

/**
 * The kinds of thing a Timeline can be read for.
 *
 * Declared once and imported wherever a scope is named, because it was written
 * twice before this and the copies had already begun to be edited separately.
 *
 * A Location and a real-world Event belong to nobody: recording the first
 * Moment at a place confers no authority over anybody else's history of it. A
 * **person** does not belong to nobody, which is why their Timeline carries a
 * check the other two have no need of.
 */
export type TimelineScopeType = "location" | "real_world_event" | "person";

/** Which scope is being read. */
export interface TimelineScopeRef {
  readonly type: TimelineScopeType;
  readonly id: string;
}

/**
 * Resolves what a Viewer may be shown, once per request, before any row is read.
 */
export class TimelineEligibilityResolver {
  /**
   * Build the resolver.
   *
   * @param dataSource - Somewhere to send PostgreSQL. Read only; nothing here
   *   writes. Typed as the narrowest thing that works so this package depends
   *   on no particular client: the API hands it a TypeORM `DataSource`, the feed
   *   aggregator a wrapper over its `pg` pool, and both already satisfy it.
   * @param adultAgeYears - The age at which age-restricted history opens.
   */
  constructor(
    private readonly dataSource: Queryable,
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

    return {
      viewerUserId,
      blocked,
      audience,
      isAdult,
      scopeIsOpen: await this.scopeIsOpen(viewerUserId, scope, blocked),
    };
  }

  /**
   * Whether this Viewer may open this scope at all.
   *
   * A Location and a real-world Event belong to nobody and are always open;
   * what a Viewer sees in one is decided row by row. A person is different,
   * because a person can be suspended and can be blocked, and neither fact is
   * visible from a Moment they merely participated in.
   *
   * @param viewerUserId - Who is asking.
   * @param scope - Which scope.
   * @param blocked - Accounts separated from the Viewer, already resolved.
   * @returns Whether to read at all. A closed scope answers empty rather than
   *   refusing, because refusing would disclose that there is something there.
   * @throws {Error} If the database refuses.
   */
  private async scopeIsOpen(
    viewerUserId: string,
    scope: TimelineScopeRef,
    blocked: readonly string[],
  ): Promise<boolean> {
    if (scope.type !== "person" || scope.id === viewerUserId) {
      return true;
    }

    if (blocked.includes(scope.id)) {
      return false;
    }

    const rows: { open: boolean }[] = await this.dataSource.query(
      // Three facts in one read, because all three close the same door and a
      // round trip each would be three where one does.
      //
      // Suspension is worded to match every other reading of that column.
      // The preference decides whether the chronological aggregate is offered
      // at all; `COALESCE` because preferences are created with the account and
      // its absence should read as the default rather than as closed.
      `SELECT u.status <> 'suspended' AND COALESCE(p.timeline_is_public, true) AS open
         FROM users u
         LEFT JOIN user_preferences p ON p.user_id = u.user_id
        WHERE u.user_id = $1`,
      [scope.id],
    );

    // An account nobody can find reads as closed. There is nothing to show for
    // it either way, and denying is the right direction to be wrong in.
    return rows[0]?.open === true;
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
  private async audienceWithin(viewerUserId: string, scope: TimelineScopeRef): Promise<string[]> {
    // Three shapes rather than one query with a branch, because the join
    // differs. The predicate is identical, which is what matters: a rule
    // written twice eventually disagrees with itself, and a join written three
    // times does not.
    //
    // The bound is weaker for a person than for a place. "Restricted Moments at
    // this Location naming me" is bounded by somewhere; "restricted Moments I
    // participated in naming me" is bounded by a relationship, and somebody who
    // records restricted history and names the same person each time grows it
    // without a ceiling. It fails in the safe direction — a Moment missing from
    // this list is withheld rather than shown — but it is a bound worth
    // watching rather than one to rely on.
    const membership =
      scope.type === "location"
        ? `JOIN moment_locations ml ON ml.moment_id = a.moment_id AND ml.location_id = $2`
        : scope.type === "real_world_event"
          ? `JOIN moment_real_world_events mre ON mre.moment_id = a.moment_id
               AND mre.real_world_event_id = $2`
          : // A person's Timeline is what they authored together with what they
            // agreed they were part of, so its membership is a union rather
            // than a single join. Authored Moments need no audience row to be
            // readable by their own author — the rule admits them first — so
            // only the participated half can contribute anything here.
            `JOIN moment_participations mp ON mp.moment_id = a.moment_id
               AND mp.user_id = $2 AND mp.status = 'accepted'`;

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
