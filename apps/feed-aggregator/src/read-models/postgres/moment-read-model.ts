import {
  commentReadableBy,
  moderationPermits,
  PositionalParameters,
  privacyPermits,
  visibleToViewer,
} from "@chronologity/moment-access";
import type { Pool } from "pg";

/**
 * Reading one Moment, whole.
 *
 * The aggregator's first reads of the authoritative tables, and a deliberate
 * widening of what this connection was for. `feed.md:307` permits direct
 * PostgreSQL access that is "limited and intentional", and its prohibition —
 * "normal feed queries must not read the API's authoritative tables" — is about
 * paging a Timeline, where a statement per item would be a statement per item.
 * Opening a Moment is neither normal nor per-item: it happens when somebody taps
 * one, and it is the only way to answer what a Moment says.
 *
 * The alternative was projecting depth into ClickHouse, and it fails on its own
 * terms. Reaction counts have no stored total by decision (ADR-113) and comment
 * counts vary with who is blocked (ADR-114), so a projection would have to store
 * numbers two ADRs refused to store, and would show five comments as three for
 * as long as it lagged.
 *
 * **Authorization happens once.** `findVisible` is the only thing that produces
 * an `AuthorizedMoment`, and every other statement here takes one. That is not a
 * convention: the API re-runs its access gate inside `relationships.list` and
 * every significance method because REST gives it no choice, and a GraphQL tree
 * that copied the shape would re-prove access four times for one Moment. The
 * type is what prevents it — the media statement below takes no Viewer at all,
 * and could not be given one without changing its signature.
 */

/** A Moment as the depth read finds it, before anything is shaped for a client. */
export interface MomentRow {
  readonly moment_id: string;
  readonly author_user_id: string;
  readonly caption: string;
  readonly occurrence_start: Date;
  readonly occurrence_end: Date;
  readonly occurrence_precision: string;
  readonly occurrence_offset_minutes: number;
  readonly visibility: string;
  readonly location_disclosure: string;
  readonly reactions_enabled: boolean;
  readonly comment_policy: string;
  readonly created_at: Date;
  /** The author, joined rather than looked up: one Moment has exactly one. */
  readonly handle: string;
  readonly display_name: string;
  readonly biography: string | null;
  readonly author_created_at: Date;
  /** The place in full, undisclosed. Null when nobody said where. */
  readonly location_id: string | null;
  readonly location_name: string | null;
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly location_precision: string | null;
  readonly neighbourhood: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly country: string | null;
  readonly country_code: string | null;
  /**
   * Selected because `disclosePlace` takes a whole Location.
   *
   * Neither reaches a client: the schema's `Location` carries a name, a
   * position and the areas around it, and provenance is the API's business.
   */
  readonly source_reference: string | null;
  readonly location_source: string | null;
  readonly location_created_at: Date | null;
  /** When this reader marked it, or null. Never anybody else's mark. */
  readonly marked_at: Date | null;
}

/**
 * A Moment this request has already proven the Viewer may read.
 *
 * Carried between resolvers rather than re-established by each of them. Nothing
 * outside `findVisible` produces one, so a field that receives it has evidence
 * rather than an assumption — and a new root field cannot reach the statements
 * below without going through the check first.
 */
export interface AuthorizedMoment {
  readonly row: MomentRow;
  /** Who proved it, so a statement needing the Viewer need not be handed one twice. */
  readonly viewerUserId: string;
}

/** One piece of media, at its position in the Moment's sequence. */
export interface MediaRow {
  readonly position: number;
  readonly upload_id: string;
  readonly kind: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly duration_seconds: string | null;
  readonly derivatives: string[] | null;
}

/** A comment as the depth read finds it, with everything about it already gathered. */
export interface CommentRow {
  readonly comment_id: string;
  readonly moment_id: string;
  readonly author_user_id: string;
  readonly body: string | null;
  readonly deleted_at: Date | null;
  readonly thread_comment_id: string | null;
  readonly in_reply_to_comment_id: string | null;
  readonly created_at: Date;
  readonly edited_at: Date | null;
  /** Null when the comment is a tombstone, which is how the author is withheld. */
  readonly handle: string | null;
  readonly display_name: string | null;
  readonly biography: string | null;
  readonly author_created_at: Date | null;
  /** Null rather than empty when nobody was named; the composer flattens it. */
  readonly mentions: { userId: string; handle: string }[] | null;
  readonly counts: { kind: string; count: number }[] | null;
  readonly yours: string | null;
}

/** How a Moment has been responded to, one row per kind anybody chose. */
export interface ReactionCountRow {
  readonly kind: string;
  readonly count: number;
  readonly mine: boolean;
}

/** A claim connecting this Moment to another. */
export interface RelationshipRow {
  readonly relationship_id: string;
  readonly source_moment_id: string;
  readonly target_moment_id: string;
  readonly kind: string;
  readonly origin: string;
  readonly asserted_by_user_id: string;
  readonly created_at: Date;
  readonly unavailable: boolean;
}

/** A page of rows, and whether the sequence continues past it. */
export interface Slice<Row> {
  readonly rows: readonly Row[];
  readonly more: boolean;
}

/** The columns a Moment read selects, written once because three statements share them. */
const MOMENT_COLUMNS = `m.moment_id, m.author_user_id, m.caption,
       m.occurrence_start, m.occurrence_end, m.occurrence_precision,
       m.occurrence_offset_minutes, m.visibility, m.location_disclosure,
       m.reactions_enabled, m.comment_policy, m.created_at,
       u.handle, u.display_name, u.biography, u.created_at AS author_created_at,
       l.location_id, l.name AS location_name, l.latitude, l.longitude,
       l.precision AS location_precision,
       l.neighbourhood, l.city, l.region, l.country, l.country_code,
       l.source_reference, l.source AS location_source,
       l.created_at AS location_created_at,
       s.marked_at`;

/**
 * Reads Moments for one Viewer at a time.
 */
export class MomentReadModel {
  /**
   * Build the read model.
   *
   * @param pool - The read-only connection this application holds. A pool and a
   *   parameterised statement cannot be talked into a write, and the credential
   *   a deployment issues is what enforces the rest.
   */
  constructor(private readonly pool: Pool) {}

  /**
   * One Moment, if this Viewer may read it.
   *
   * The author, the place and this reader's own significance mark are joined
   * rather than fetched: each is one-to-one with the Moment, so they cost
   * nothing beyond the columns. The mark's guarantee lives in the join
   * condition rather than in a later mapping step, so there is no path through
   * this code that could return somebody else's.
   *
   * @param momentId - Which Moment. Untrusted, and compared against a `uuid`
   *   column, so a caller must have validated its shape.
   * @param viewerUserId - Who is asking.
   * @param viewerIsAdult - Whether they are old enough for age-restricted
   *   history, resolved once per request rather than joined per row.
   * @returns The Moment with its proof of access, or undefined — which means
   *   every refusal at once: no such Moment, it is private, its author blocked
   *   them, they are not on its list, or Chronologity withheld it. A caller must
   *   not distinguish them, because distinguishing them discloses which applied.
   * @throws {Error} If PostgreSQL refuses the statement.
   */
  async findVisible(
    momentId: string,
    viewerUserId: string,
    viewerIsAdult: boolean,
  ): Promise<AuthorizedMoment | undefined> {
    const bind = new PositionalParameters();
    const viewer = {
      viewerUserId: bind.bind(viewerUserId),
      viewerIsAdult: bind.bind(viewerIsAdult),
    };
    const id = bind.bind(momentId);

    const result = await this.pool.query<MomentRow>(
      `SELECT ${MOMENT_COLUMNS}
         FROM moments m
         JOIN users u ON u.user_id = m.author_user_id
         LEFT JOIN moment_locations ml ON ml.moment_id = m.moment_id
         LEFT JOIN locations l ON l.location_id = ml.location_id
         LEFT JOIN moment_personal_significance s
                ON s.moment_id = m.moment_id AND s.user_id = ${viewer.viewerUserId}
        WHERE m.moment_id = ${id}
          AND m.deleted_at IS NULL
          AND ${visibleToViewer("m", viewer)}`,
      [...bind.values],
    );

    const row = result.rows[0];

    return row === undefined ? undefined : { row, viewerUserId };
  }

  /**
   * A page of a Moment's media, in the order its author arranged it.
   *
   * **Takes no Viewer**, and that is the point rather than an omission. Reaching
   * this means holding an `AuthorizedMoment`, which only the check above
   * produces; adding the Moment predicate here would be a second authorization,
   * and a second authorization is a second place for the first one to be wrong.
   *
   * Keyset on `position`, which is dense, zero-based and unique within a Moment,
   * so it totally orders the sequence and no tiebreaker should be invented.
   * Offsets would be wrong for the usual reason and one particular one: media
   * can be reordered while somebody pages it.
   *
   * @param moment - The Moment, already proven readable.
   * @param limit - How many to return.
   * @param after - The position to resume past, or undefined to start.
   * @returns The page, and whether the sequence continues. One row beyond the
   *   page is asked for and never returned; its presence is the answer.
   * @throws {Error} If PostgreSQL refuses the statement.
   */
  async media(
    moment: AuthorizedMoment,
    limit: number,
    after: number | undefined,
  ): Promise<Slice<MediaRow>> {
    const bind = new PositionalParameters();
    const id = bind.bind(moment.row.moment_id);
    const from = bind.bind(after ?? null);
    const probe = bind.bind(limit + 1);

    const result = await this.pool.query<MediaRow>(
      `SELECT mm.position,
              up.upload_id,
              -- What a decoder found, falling back to what was declared. The
              -- finding is the one worth trusting (ADR-086); the declaration is
              -- what there is before anything has been opened.
              COALESCE(up.media_kind, up.kind) AS kind,
              up.width, up.height, up.duration_seconds, up.derivatives
         FROM moment_media mm
         JOIN uploads up ON up.upload_id = mm.upload_id
        WHERE mm.moment_id = ${id}
          AND (${from}::int IS NULL OR mm.position > ${from}::int)
        ORDER BY mm.position ASC
        LIMIT ${probe}`,
      [...bind.values],
    );

    return {
      rows: result.rows.slice(0, limit),
      more: result.rows.length > limit,
    };
  }

  /**
   * A page of discussion, oldest first.
   *
   * **One statement, not four.** The API spends one on the page, one on
   * mentions, one on reactions and one on the count, because REST asks them
   * separately. Lateral joins gather the first three per row, which is batching
   * done by the database rather than by JavaScript — and it means a thread of
   * thirty costs one round trip rather than sixty. When request-scoped loaders
   * arrive they can replace the laterals without any row shape changing.
   *
   * Oldest first, unlike everything else here. Showing the beginning of a
   * conversation preserves the context that makes later replies comprehensible.
   *
   * A deleted comment is carried when it still has live replies, so the replies
   * have something to hang from, and dropped when it does not.
   *
   * @param moment - The Moment, already proven readable.
   * @param limit - How many to return.
   * @param after - Where to resume, or undefined to start at the beginning.
   * @param thread - A top-level comment whose replies are wanted, or undefined
   *   for the top level itself.
   * @returns The page, and whether the discussion continues.
   * @throws {Error} If PostgreSQL refuses the statement.
   */
  async comments(
    moment: AuthorizedMoment,
    limit: number,
    after: { createdAt: Date; commentId: string } | undefined,
    thread: string | undefined,
  ): Promise<Slice<CommentRow>> {
    const bind = new PositionalParameters();
    const viewer = { viewerUserId: bind.bind(moment.viewerUserId) };
    const id = bind.bind(moment.row.moment_id);
    const level =
      thread === undefined
        ? "c.thread_comment_id IS NULL"
        : `c.thread_comment_id = ${bind.bind(thread)}`;
    const resume =
      after === undefined
        ? ""
        : `AND (c.created_at, c.comment_id) > (${bind.bind(after.createdAt)}, ${bind.bind(after.commentId)})`;
    const probe = bind.bind(limit + 1);

    const result = await this.pool.query<CommentRow>(
      `SELECT c.comment_id, c.moment_id, c.author_user_id, c.body, c.deleted_at,
              c.thread_comment_id, c.in_reply_to_comment_id, c.created_at, c.edited_at,
              a.handle, a.display_name, a.biography, a.created_at AS author_created_at,
              mentioned.list AS mentions,
              responses.counts,
              responses.yours
         FROM moment_comments c
         LEFT JOIN users a ON a.user_id = c.author_user_id
         LEFT JOIN LATERAL (
           -- The handle as it stands now, which may not be the one that was
           -- typed: a mention is resolved to identity, so a rename does not
           -- leave old text pointing at whoever holds the name today.
           SELECT json_agg(json_build_object('userId', mu.user_id, 'handle', mu.handle)
                           ORDER BY mu.handle) AS list
             FROM comment_mentions cm
             JOIN users mu ON mu.user_id = cm.user_id
            WHERE cm.comment_id = c.comment_id
         ) mentioned ON true
         LEFT JOIN LATERAL (
           SELECT json_agg(json_build_object('kind', k.kind, 'count', k.count)) AS counts,
                  max(k.mine) AS yours
             FROM (
               SELECT cr.kind,
                      -- Suspension filters the count and not the rows. Moved
                      -- into the WHERE it would take a suspended reader's own
                      -- row away before the aggregate could see it, and stop
                      -- telling them what they themselves chose.
                      count(*) FILTER (
                        WHERE NOT EXISTS (
                          SELECT 1 FROM users ru
                           WHERE ru.user_id = cr.user_id AND ru.status = 'suspended'
                        )
                      )::int AS count,
                      max(cr.kind) FILTER (WHERE cr.user_id = ${viewer.viewerUserId}) AS mine
                 FROM comment_reactions cr
                WHERE cr.comment_id = c.comment_id
                GROUP BY cr.kind
             ) k
         ) responses ON true
        WHERE c.moment_id = ${id}
          AND ${level}
          AND ${commentReadableBy("c", viewer)}
          AND (
            c.deleted_at IS NULL
            OR EXISTS (
              SELECT 1 FROM moment_comments r
               WHERE r.thread_comment_id = c.comment_id AND r.deleted_at IS NULL
            )
          )
          ${resume}
        ORDER BY c.created_at ASC, c.comment_id ASC
        LIMIT ${probe}`,
      [...bind.values],
    );

    return { rows: result.rows.slice(0, limit), more: result.rows.length > limit };
  }

  /**
   * How many comments this reader may see, replies included.
   *
   * Its own field on the connection rather than part of the page, so nobody
   * pays for a full count while scrolling. It has to be a count rather than the
   * page's length: `total` answers "how many people spoke", and a page answers
   * "what is on this screen".
   *
   * Excludes tombstones, which the page still carries when they hold replies.
   * A count that included them would say somebody spoke where nobody did.
   *
   * @param moment - The Moment, already proven readable.
   * @returns How many comments there are.
   * @throws {Error} If PostgreSQL refuses the statement.
   */
  async commentCount(moment: AuthorizedMoment): Promise<number> {
    const bind = new PositionalParameters();
    const viewer = { viewerUserId: bind.bind(moment.viewerUserId) };
    const id = bind.bind(moment.row.moment_id);

    const result = await this.pool.query<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM moment_comments c
        WHERE c.moment_id = ${id}
          AND c.deleted_at IS NULL
          AND ${commentReadableBy("c", viewer)}`,
      [...bind.values],
    );

    return result.rows[0]?.total ?? 0;
  }

  /**
   * How a Moment has been responded to.
   *
   * Counts, never identities. Showing an aggregate and showing exactly who
   * reacted are different things, and a list of reactors on a restricted Moment
   * would reveal that Moment's audience to everybody on it.
   *
   * One statement where the API spends two, and the difference is where
   * suspension is applied: filtering the count rather than the rows keeps a
   * suspended reader's own reaction visible to them while removing it from what
   * everybody else is told.
   *
   * @param moment - The Moment, already proven readable.
   * @returns One row per kind anybody chose, with whether this reader chose it.
   *   A kind nobody chose is absent rather than zero, and a kind chosen only by
   *   suspended people comes back with a count of zero for the composer to drop.
   * @throws {Error} If PostgreSQL refuses the statement.
   */
  async reactions(moment: AuthorizedMoment): Promise<readonly ReactionCountRow[]> {
    const bind = new PositionalParameters();
    const id = bind.bind(moment.row.moment_id);
    const viewer = bind.bind(moment.viewerUserId);

    const result = await this.pool.query<ReactionCountRow>(
      `SELECT r.kind,
              count(*) FILTER (
                WHERE NOT EXISTS (
                  SELECT 1 FROM users ru
                   WHERE ru.user_id = r.user_id AND ru.status = 'suspended'
                )
              )::int AS count,
              bool_or(r.user_id = ${viewer}) AS mine
         FROM moment_reactions r
        WHERE r.moment_id = ${id}
        GROUP BY r.kind`,
      [...bind.values],
    );

    return result.rows;
  }

  /**
   * What this Moment is connected to, in both directions.
   *
   * **The two halves of the rule are applied differently, and that is the whole
   * point of this statement.** Privacy withholding the far end removes the
   * relationship entirely, because an identifier pointing at an inaccessible
   * Moment is itself the disclosure. Moderation withholding it leaves the row
   * with `unavailable` set, because a chain should keep its shape and
   * Chronologity admitting its own act discloses nothing about anybody else.
   *
   * Getting those the wrong way round leaks private history, which is why the
   * shared package exports both halves rather than only their conjunction.
   *
   * @param moment - The Moment, already proven readable.
   * @param viewerIsAdult - Whether the reader is old enough, which the
   *   moderation half asks about the far end.
   * @param limit - How many to return.
   * @returns The claims, newest first.
   * @throws {Error} If PostgreSQL refuses the statement.
   */
  async relationships(
    moment: AuthorizedMoment,
    viewerIsAdult: boolean,
    limit: number,
  ): Promise<readonly RelationshipRow[]> {
    const bind = new PositionalParameters();
    const viewer = {
      viewerUserId: bind.bind(moment.viewerUserId),
      viewerIsAdult: bind.bind(viewerIsAdult),
    };
    const id = bind.bind(moment.row.moment_id);
    const most = bind.bind(limit);

    const result = await this.pool.query<RelationshipRow>(
      `SELECT r.relationship_id, r.source_moment_id, r.target_moment_id,
              r.kind, r.origin, r.asserted_by_user_id, r.created_at,
              NOT ${moderationPermits("other", viewer)} AS unavailable
         FROM moment_relationships r
         JOIN moments other
           ON other.moment_id = CASE
                WHEN r.source_moment_id = ${id} THEN r.target_moment_id
                ELSE r.source_moment_id
              END
        WHERE (r.source_moment_id = ${id} OR r.target_moment_id = ${id})
          AND other.deleted_at IS NULL
          AND ${privacyPermits("other", viewer)}
        ORDER BY r.created_at DESC, r.relationship_id DESC
        LIMIT ${most}`,
      [...bind.values],
    );

    return result.rows;
  }
}

