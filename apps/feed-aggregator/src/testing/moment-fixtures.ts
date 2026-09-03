import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

/**
 * Arranging Moments to read.
 *
 * By SQL, because the fixtures that would otherwise build these live in
 * `apps/api`, which this application may not import. That is a test running
 * under the developer's role and never application code: this service reads and
 * never writes, and the credential a deployment issues is what enforces it.
 *
 * Shared between the depth suites so that a Moment means the same thing in each
 * of them — a fixture that drifts between two suites makes them quietly stop
 * testing the same shape.
 */

/** Somebody, with whatever this test needs true of them. */
export interface Person {
  readonly userId: string;
  readonly identityId: string;
  readonly handle: string;
}

/**
 * Create an account, and the Identity a User cannot exist without.
 *
 * @param pool - The connection to arrange through.
 * @param over - Anything this account needs different: suspension, or an age.
 * @returns The person.
 */
export async function createPerson(
  pool: Pool,
  over: { status?: string; bornYearsAgo?: number } = {},
): Promise<Person> {
  const userId = randomUUID();
  const identityId = randomUUID();
  const handle = `h${userId.replaceAll("-", "").slice(0, 12)}`;

  await pool.query("INSERT INTO identities (identity_id, created_at) VALUES ($1, now())", [
    identityId,
  ]);
  await pool.query(
    `INSERT INTO users (user_id, identity_id, handle, display_name, status, created_at)
     VALUES ($1, $2, $3, $3, $4, now())`,
    [userId, identityId, handle, over.status ?? "active"],
  );

  if (over.bornYearsAgo !== undefined) {
    await pool.query(
      `INSERT INTO user_restricted_data (user_id, date_of_birth, minimum_age_at_creation, recorded_at)
       VALUES ($1, CURRENT_DATE - make_interval(years => $2), 13, now())`,
      [userId, over.bornYearsAgo],
    );
  }

  return { userId, identityId, handle };
}

/**
 * Record a Moment.
 *
 * @param pool - The connection to arrange through.
 * @param authorUserId - Who recorded it.
 * @param over - Anything it needs different.
 * @returns The Moment's identifier.
 */
export async function createMoment(
  pool: Pool,
  authorUserId: string,
  over: {
    caption?: string;
    visibility?: string;
    locationDisclosure?: string;
    reactionsEnabled?: boolean;
    commentPolicy?: string;
    occurredAt?: string;
  } = {},
): Promise<string> {
  const momentId = randomUUID();
  const occurredAt = over.occurredAt ?? "1998-07-04T19:30:00.000Z";

  await pool.query(
    `INSERT INTO moments (moment_id, author_user_id, caption, occurrence_start, occurrence_end,
                          occurrence_precision, occurrence_offset_minutes, visibility,
                          location_disclosure, reactions_enabled, comment_policy)
     VALUES ($1, $2, $3, $4, $4, 'instant', 60, $5, $6, $7, $8)`,
    [
      momentId,
      authorUserId,
      over.caption ?? "the afternoon it finally stopped raining",
      occurredAt,
      over.visibility ?? "public",
      over.locationDisclosure ?? "exact",
      over.reactionsEnabled ?? true,
      over.commentPolicy ?? "anyone",
    ],
  );

  return momentId;
}

/**
 * Put a place on a Moment.
 *
 * @param pool - The connection to arrange through.
 * @param momentId - Which Moment.
 * @param recordedByUserId - Who recorded the place.
 * @returns The Location's identifier.
 */
export async function createPlace(
  pool: Pool,
  momentId: string,
  recordedByUserId: string,
): Promise<string> {
  const locationId = randomUUID();

  await pool.query(
    `INSERT INTO locations (location_id, recorded_by_user_id, name, latitude, longitude,
                            precision, neighbourhood, city, region, country, country_code,
                            source, created_at)
     VALUES ($1, $2, 'Madison Square Garden', 40.7505, -73.9934, 'exact',
             'Midtown', 'New York', 'New York', 'United States', 'US',
             'explicit-selection', now())`,
    [locationId, recordedByUserId],
  );
  await pool.query("INSERT INTO moment_locations (moment_id, location_id) VALUES ($1, $2)", [
    momentId,
    locationId,
  ]);

  return locationId;
}

/**
 * Attach media to a Moment, in order.
 *
 * @param pool - The connection to arrange through.
 * @param momentId - Which Moment.
 * @param ownerUserId - Whose upload it is.
 * @param count - How many pieces of media.
 * @param kind - `image` or `video`.
 * @returns The upload identifiers, in the order they were positioned.
 */
export async function attachMedia(
  pool: Pool,
  momentId: string,
  ownerUserId: string,
  count: number,
  kind: "image" | "video" = "image",
): Promise<string[]> {
  const uploadIds: string[] = [];

  for (let position = 0; position < count; position += 1) {
    const uploadId = randomUUID();

    await pool.query(
      `INSERT INTO uploads (upload_id, owner_user_id, kind, declared_content_type,
                            declared_byte_size, storage_key, state, registered_at, expires_at,
                            media_kind, width, height, duration_seconds, derivatives)
       VALUES ($1, $2, $3, $4, 1024, $5, 'ready', now(), now() + interval '1 day',
               $3, 1200, 900, $6, ARRAY['thumbnail'])`,
      [
        uploadId,
        ownerUserId,
        kind,
        kind === "video" ? "video/mp4" : "image/jpeg",
        `uploads/${ownerUserId}/${uploadId}/original`,
        kind === "video" ? 12.5 : null,
      ],
    );
    await pool.query(
      "INSERT INTO moment_media (moment_id, upload_id, position) VALUES ($1, $2, $3)",
      [momentId, uploadId, position],
    );

    uploadIds.push(uploadId);
  }

  return uploadIds;
}

/**
 * Say something about a Moment.
 *
 * @param pool - The connection to arrange through.
 * @param momentId - Which Moment.
 * @param authorUserId - Who said it.
 * @param over - Anything it needs different: a thread, an instant, a deletion.
 * @returns The comment's identifier.
 */
export async function createComment(
  pool: Pool,
  momentId: string,
  authorUserId: string,
  over: { body?: string; threadCommentId?: string; createdAt?: string; deleted?: boolean } = {},
): Promise<string> {
  const commentId = randomUUID();

  await pool.query(
    `INSERT INTO moment_comments (comment_id, moment_id, author_user_id, thread_comment_id,
                                  in_reply_to_comment_id, body, created_at, deleted_at)
     VALUES ($1, $2, $3, $4, $4, $5, COALESCE($6::timestamptz, now()), $7)`,
    [
      commentId,
      momentId,
      authorUserId,
      over.threadCommentId ?? null,
      over.body ?? "I remember that day",
      over.createdAt ?? null,
      over.deleted === true ? new Date() : null,
    ],
  );

  return commentId;
}

/**
 * Withhold something, as moderation would.
 *
 * @param pool - The connection to arrange through.
 * @param subjectType - `moment` or `comment`.
 * @param subjectId - Which one.
 * @param state - The decision.
 * @returns Nothing.
 */
export async function moderate(
  pool: Pool,
  subjectType: string,
  subjectId: string,
  state: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO moderation_states (subject_type, subject_id, state, reason, decided_at)
     VALUES ($1, $2, $3, 'a depth integration test', now())
     ON CONFLICT (subject_type, subject_id) DO UPDATE SET state = $3`,
    [subjectType, subjectId, state],
  );
}

/**
 * Remove everything these people ever touched.
 *
 * Innermost first. Several of these references are `RESTRICT` rather than
 * cascading — deliberately, since what becomes of somebody's history when they
 * leave is the deletion service's decision — so the order is the constraint
 * graph read backwards rather than a preference.
 *
 * @param pool - The connection to clean through.
 * @param people - Everybody this suite created.
 * @returns Nothing.
 */
export async function removePeople(pool: Pool, people: readonly Person[]): Promise<void> {
  const userIds = people.map((person) => person.userId);
  const identityIds = people.map((person) => person.identityId);

  const moments = await pool.query<{ moment_id: string }>(
    "SELECT moment_id FROM moments WHERE author_user_id = ANY($1)",
    [userIds],
  );
  const momentIds = moments.rows.map((row) => row.moment_id);

  await pool.query("DELETE FROM moderation_states WHERE subject_id = ANY($1)", [momentIds]);
  await pool.query(
    `DELETE FROM moderation_states
      WHERE subject_id IN (SELECT comment_id FROM moment_comments WHERE moment_id = ANY($1))`,
    [momentIds],
  );
  await pool.query("DELETE FROM comment_reactions WHERE user_id = ANY($1)", [userIds]);
  await pool.query("DELETE FROM comment_mentions WHERE user_id = ANY($1)", [userIds]);
  await pool.query("DELETE FROM moment_comments WHERE moment_id = ANY($1)", [momentIds]);
  await pool.query("DELETE FROM moment_reactions WHERE moment_id = ANY($1)", [momentIds]);
  await pool.query("DELETE FROM moment_relationships WHERE asserted_by_user_id = ANY($1)", [
    userIds,
  ]);
  await pool.query("DELETE FROM moment_personal_significance WHERE user_id = ANY($1)", [userIds]);
  await pool.query("DELETE FROM moment_audience WHERE user_id = ANY($1)", [userIds]);
  await pool.query("DELETE FROM moment_media WHERE moment_id = ANY($1)", [momentIds]);
  await pool.query("DELETE FROM moment_locations WHERE moment_id = ANY($1)", [momentIds]);
  await pool.query("DELETE FROM moments WHERE author_user_id = ANY($1)", [userIds]);
  await pool.query("DELETE FROM uploads WHERE owner_user_id = ANY($1)", [userIds]);
  await pool.query("DELETE FROM locations WHERE recorded_by_user_id = ANY($1)", [userIds]);
  await pool.query(
    "DELETE FROM user_blocks WHERE blocker_user_id = ANY($1) OR blocked_user_id = ANY($1)",
    [userIds],
  );
  await pool.query("DELETE FROM user_restricted_data WHERE user_id = ANY($1)", [userIds]);
  await pool.query("DELETE FROM user_preferences WHERE user_id = ANY($1)", [userIds]);
  await pool.query("DELETE FROM sessions WHERE identity_id = ANY($1)", [identityIds]);
  await pool.query("DELETE FROM users WHERE user_id = ANY($1)", [userIds]);
  await pool.query("DELETE FROM identities WHERE identity_id = ANY($1)", [identityIds]);
}
