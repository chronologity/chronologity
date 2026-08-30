import type { DataSource } from "typeorm";
import type {
  AccountSource,
  CommentSource,
  ParticipationSource,
  SavedViewSource,
  MomentSource,
  ReactionSource,
} from "./export-document.js";

/** Somebody an account is connected to. */
export interface RelationshipSource {
  readonly handle: string;
  readonly displayName: string;
}

/** A moderation decision about the account's own content. */
export interface ModerationSource {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly state: string;
  readonly reason: string;
  readonly decidedAt: Date;
}

/**
 * Reading what an account is entitled to take with it.
 *
 * Every query here is keyed on the account, and that is the whole isolation
 * story: nothing selects by anything else, so no result can belong to somebody
 * else. `architecture/privacy.md:1288` requires an export not to expose other
 * people's private data, and the reliable way to satisfy that is for the
 * queries to be incapable of returning it rather than for a later stage to
 * filter it out.
 *
 * The one place other people appear is as authors of comments and reactions on
 * the account's own Moments — which the account can already read — and those
 * are joined to `users` for a handle and a display name and nothing else.
 */
export class ExportSourceRepository {
  /**
   * Build the export source repository.
   *
   * @param dataSource - Read-only here. An export changes nothing.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The account itself.
   *
   * @param userId - Whose.
   * @returns Their profile, preferences, and date of birth, or undefined when
   *   there is no such account.
   */
  async account(userId: string): Promise<AccountSource | undefined> {
    const rows: {
      handle: string;
      display_name: string;
      biography: string | null;
      created_at: Date;
      date_of_birth: string | null;
      autoplay_videos: boolean;
      autoplay_sound: boolean;
      locale: string | null;
      time_zone: string | null;
      reduced_motion: boolean;
    }[] = await this.dataSource.query(
      `SELECT account.handle, account.display_name, account.biography, account.created_at,
              restricted.date_of_birth,
              preference.autoplay_videos, preference.autoplay_sound, preference.locale,
              preference.time_zone, preference.reduced_motion
         FROM users account
         LEFT JOIN user_preferences preference ON preference.user_id = account.user_id
         LEFT JOIN user_restricted_data restricted ON restricted.user_id = account.user_id
        WHERE account.user_id = $1`,
      [userId],
    );

    const row = rows[0];

    if (row === undefined) {
      return undefined;
    }

    return {
      handle: row.handle,
      displayName: row.display_name,
      biography: row.biography,
      createdAt: row.created_at,
      dateOfBirth: row.date_of_birth,
      preferences: {
        autoplayVideos: row.autoplay_videos ?? true,
        autoplaySound: row.autoplay_sound ?? true,
        locale: row.locale,
        timeZone: row.time_zone,
        reducedMotion: row.reduced_motion ?? false,
      },
    };
  }

  /**
   * How many Moments the account has, so the parts can be planned.
   *
   * @param userId - Whose.
   * @returns The count, deleted ones excluded: a Moment marked deleted is one
   *   the person asked to be rid of, and putting it in their export would hand
   *   back what they removed.
   */
  async momentCount(userId: string): Promise<number> {
    const rows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS count FROM moments
        WHERE author_user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );

    return Number(rows[0]?.count ?? "0");
  }

  /**
   * One page of the account's Moments, with their place and their media.
   *
   * @param userId - Whose.
   * @param limit - How many.
   * @param offset - Where to start.
   * @returns The Moments, oldest first. Ordered by occurrence rather than by
   *   when they were recorded, because that is the order the history happened
   *   in and an export is a record of a history.
   */
  async moments(userId: string, limit: number, offset: number): Promise<MomentSource[]> {
    const rows: {
      moment_id: string;
      caption: string;
      occurrence_start: Date;
      occurrence_end: Date;
      occurrence_precision: string;
      occurrence_offset_minutes: number;
      visibility: string;
      created_at: Date;
      place_name: string | null;
      place_precision: string | null;
      latitude: string | null;
      longitude: string | null;
    }[] = await this.dataSource.query(
      `SELECT moment.moment_id, moment.caption, moment.occurrence_start, moment.occurrence_end,
              moment.occurrence_precision, moment.occurrence_offset_minutes,
              moment.visibility, moment.created_at,
              place.name AS place_name, place.precision AS place_precision,
              place.latitude, place.longitude
         FROM moments moment
         LEFT JOIN moment_locations link ON link.moment_id = moment.moment_id
         LEFT JOIN locations place ON place.location_id = link.location_id
        WHERE moment.author_user_id = $1 AND moment.deleted_at IS NULL
        ORDER BY moment.occurrence_start ASC, moment.moment_id ASC
        LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );

    if (rows.length === 0) {
      return [];
    }

    const media = await this.mediaFor(rows.map((row) => row.moment_id));

    return rows.map((row) => ({
      momentId: row.moment_id,
      caption: row.caption,
      occurrenceStart: row.occurrence_start,
      occurrenceEnd: row.occurrence_end,
      occurrencePrecision: row.occurrence_precision,
      occurrenceOffsetMinutes: row.occurrence_offset_minutes,
      visibility: row.visibility,
      createdAt: row.created_at,
      place:
        row.place_name === null || row.place_precision === null
          ? null
          : {
              name: row.place_name,
              precision: row.place_precision,
              latitude: row.latitude === null ? null : Number(row.latitude),
              longitude: row.longitude === null ? null : Number(row.longitude),
            },
      media: media.get(row.moment_id) ?? [],
    }));
  }

  /**
   * The media on a page of Moments.
   *
   * One query for the page rather than one per Moment, so a part costs two
   * reads however many Moments it holds.
   *
   * @param momentIds - The page.
   * @returns Their media, keyed by Moment, in presentation order.
   */
  private async mediaFor(
    momentIds: readonly string[],
  ): Promise<Map<string, MomentSource["media"][number][]>> {
    const rows: {
      moment_id: string;
      upload_id: string;
      kind: string;
      content_type: string | null;
      byte_size: string | null;
    }[] = await this.dataSource.query(
      `SELECT link.moment_id, upload.upload_id, upload.kind,
              upload.content_type, upload.byte_size
         FROM moment_media link
         JOIN uploads upload ON upload.upload_id = link.upload_id
        WHERE link.moment_id = ANY($1::uuid[])
        ORDER BY link.moment_id, link.position ASC`,
      [[...momentIds]],
    );

    const byMoment = new Map<string, MomentSource["media"][number][]>();

    for (const row of rows) {
      const existing = byMoment.get(row.moment_id) ?? [];

      existing.push({
        uploadId: row.upload_id,
        kind: row.kind,
        contentType: row.content_type,
        byteSize: row.byte_size === null ? null : Number(row.byte_size),
      });
      byMoment.set(row.moment_id, existing);
    }

    return byMoment;
  }

  /**
   * Every upload the account's live Moments hold.
   *
   * @param userId - Whose.
   * @returns Their identifiers and storage keys, so the manifest can sign the
   *   originals. The keys stay in this process and never reach the export.
   */
  async mediaToSign(
    userId: string,
  ): Promise<
    {
      uploadId: string;
      kind: string;
      contentType: string | null;
      byteSize: number | null;
      storageKey: string;
    }[]
  > {
    const rows: {
      upload_id: string;
      kind: string;
      content_type: string | null;
      byte_size: string | null;
      storage_key: string;
    }[] = await this.dataSource.query(
      `SELECT DISTINCT upload.upload_id, upload.kind, upload.content_type,
              upload.byte_size, upload.storage_key
         FROM uploads upload
         JOIN moment_media link ON link.upload_id = upload.upload_id
         JOIN moments moment ON moment.moment_id = link.moment_id
        WHERE moment.author_user_id = $1
          AND moment.deleted_at IS NULL
          AND upload.state <> 'deleted'`,
      [userId],
    );

    return rows.map((row) => ({
      uploadId: row.upload_id,
      kind: row.kind,
      contentType: row.content_type,
      byteSize: row.byte_size === null ? null : Number(row.byte_size),
      storageKey: row.storage_key,
    }));
  }

  /**
   * Comments the account wrote, and comments written on its Moments.
   *
   * @param userId - Whose.
   * @returns Both, with authors by handle. Other people appear here because the
   *   account can already read what they wrote on its own Moments; deleted
   *   comments are absent, their bodies having been blanked when they went.
   */
  async comments(userId: string): Promise<CommentSource[]> {
    const rows: {
      comment_id: string;
      moment_id: string;
      body: string;
      created_at: Date;
      handle: string;
      display_name: string;
    }[] = await this.dataSource.query(
      `SELECT comment.comment_id, comment.moment_id, comment.body, comment.created_at,
              author.handle, author.display_name
         FROM moment_comments comment
         JOIN users author ON author.user_id = comment.author_user_id
         LEFT JOIN moments moment ON moment.moment_id = comment.moment_id
        WHERE comment.deleted_at IS NULL
          AND (comment.author_user_id = $1 OR moment.author_user_id = $1)
        ORDER BY comment.created_at ASC`,
      [userId],
    );

    return rows.map((row) => ({
      commentId: row.comment_id,
      momentId: row.moment_id,
      body: row.body,
      createdAt: row.created_at,
      author: { handle: row.handle, displayName: row.display_name },
    }));
  }

  /**
   * Reactions the account made, and reactions to its Moments.
   *
   * @param userId - Whose.
   * @returns Both, attributed by handle.
   */
  async reactions(userId: string): Promise<ReactionSource[]> {
    const rows: {
      moment_id: string;
      kind: string;
      created_at: Date;
      handle: string;
      display_name: string;
    }[] = await this.dataSource.query(
      `SELECT reaction.moment_id, reaction.kind, reaction.created_at,
              person.handle, person.display_name
         FROM moment_reactions reaction
         JOIN users person ON person.user_id = reaction.user_id
         LEFT JOIN moments moment ON moment.moment_id = reaction.moment_id
        WHERE reaction.user_id = $1 OR moment.author_user_id = $1
        ORDER BY reaction.created_at ASC`,
      [userId],
    );

    return rows.map((row) => ({
      momentId: row.moment_id,
      kind: row.kind,
      createdAt: row.created_at,
      by: { handle: row.handle, displayName: row.display_name },
    }));
  }

  /**
   * Every participation this account is part of, in either direction.
   *
   * Both directions, because both are records about them: what other people
   * said about where they were, and what they said about other people. Proposals
   * nobody answered are included — a claim somebody made is a record whether or
   * not it was ever confirmed.
   *
   * @param userId - Whose.
   * @returns The rows, oldest first, everybody by handle.
   * @throws {Error} If the database refuses.
   */
  async participations(userId: string): Promise<ParticipationSource[]> {
    const rows: {
      moment_id: string;
      status: string;
      proposed_at: Date;
      resolved_at: Date | null;
      direction: "named-me" | "i-named";
      handle: string;
      display_name: string;
    }[] = await this.dataSource.query(
      `SELECT p.moment_id, p.status, p.proposed_at, p.resolved_at,
              CASE WHEN p.user_id = $1 THEN 'named-me' ELSE 'i-named' END AS direction,
              person.handle, person.display_name
         FROM moment_participations p
         JOIN moments m ON m.moment_id = p.moment_id
         -- The other person: the author when this account was named, and the
         -- named person when this account is the author who proposed.
         JOIN users person
           ON person.user_id = CASE WHEN p.user_id = $1 THEN m.author_user_id ELSE p.user_id END
        WHERE p.user_id = $1 OR m.author_user_id = $1
        ORDER BY p.proposed_at ASC`,
      [userId],
    );

    return rows.map((row) => ({
      momentId: row.moment_id,
      status: row.status,
      proposedAt: row.proposed_at,
      resolvedAt: row.resolved_at,
      direction: row.direction,
      person: { handle: row.handle, displayName: row.display_name },
    }));
  }

  /**
   * Every perspective on history the account kept.
   *
   * Their own notes about their own history, so they leave with them. Shares are
   * deliberately absent: a link is a thing they gave to somebody else, and its
   * token is a secret whose only purpose is to be held by the recipient.
   *
   * @param userId - Whose.
   * @returns The views, oldest first.
   * @throws {Error} If the database refuses.
   */
  async savedViews(userId: string): Promise<SavedViewSource[]> {
    const rows: {
      title: string;
      created_at: Date;
      last_visited_at: Date | null;
      specification: unknown;
    }[] = await this.dataSource.query(
      `SELECT title, created_at, last_visited_at, specification
         FROM saved_views
        WHERE user_id = $1
        ORDER BY created_at ASC`,
      [userId],
    );

    return rows.map((row) => ({
      title: row.title,
      createdAt: row.created_at,
      lastVisitedAt: row.last_visited_at,
      specification: row.specification,
    }));
  }

  /**
   * Who the account follows, who follows it, and who it has blocked.
   *
   * @param userId - Whose.
   * @returns The three lists, everybody by handle. Who blocked *them* is
   *   deliberately absent: that is somebody else's decision about their own
   *   safety, and an export is not a way to discover it.
   */
  async relationships(userId: string): Promise<{
    following: RelationshipSource[];
    followers: RelationshipSource[];
    blocked: RelationshipSource[];
  }> {
    const read = async (statement: string): Promise<RelationshipSource[]> => {
      const rows: { handle: string; display_name: string }[] =
        await this.dataSource.query(statement, [userId]);

      return rows.map((row) => ({ handle: row.handle, displayName: row.display_name }));
    };

    return {
      following: await read(
        `SELECT person.handle, person.display_name
           FROM user_follows link JOIN users person ON person.user_id = link.followed_user_id
          WHERE link.follower_user_id = $1 ORDER BY person.handle`,
      ),
      followers: await read(
        `SELECT person.handle, person.display_name
           FROM user_follows link JOIN users person ON person.user_id = link.follower_user_id
          WHERE link.followed_user_id = $1 ORDER BY person.handle`,
      ),
      blocked: await read(
        `SELECT person.handle, person.display_name
           FROM user_blocks link JOIN users person ON person.user_id = link.blocked_user_id
          WHERE link.blocker_user_id = $1 ORDER BY person.handle`,
      ),
    };
  }

  /**
   * What Chronologity decided about the account's content.
   *
   * @param userId - Whose.
   * @returns The decisions, without who made them. 5N keeps reviewer identity
   *   from the person a decision affected, and an export would be the easiest
   *   way around that; the reporter of a report about them is absent for the
   *   same reason.
   */
  async moderation(userId: string): Promise<ModerationSource[]> {
    const rows: {
      subject_type: string;
      subject_id: string;
      state: string;
      reason: string;
      decided_at: Date;
    }[] = await this.dataSource.query(
      `SELECT state.subject_type, state.subject_id, state.state, state.reason, state.decided_at
         FROM moderation_states state
         LEFT JOIN moments moment
           ON state.subject_type = 'moment' AND moment.moment_id = state.subject_id
         LEFT JOIN moment_comments comment
           ON state.subject_type = 'comment' AND comment.comment_id = state.subject_id
        WHERE moment.author_user_id = $1
           OR comment.author_user_id = $1
           OR (state.subject_type = 'user' AND state.subject_id = $1)
        ORDER BY state.decided_at ASC`,
      [userId],
    );

    return rows.map((row) => ({
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      state: row.state,
      reason: row.reason,
      decidedAt: row.decided_at,
    }));
  }
}
