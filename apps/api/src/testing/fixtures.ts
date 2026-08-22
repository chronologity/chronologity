import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";

/**
 * Parent rows, for tests about something else.
 *
 * The schema has foreign keys, so a Session needs an Identity that exists and
 * an Upload needs an owner. Before those constraints a test could pass
 * `randomUUID()` wherever an identifier was wanted, which meant a good many
 * tests asserted against states the application cannot produce.
 *
 * These insert directly rather than going through the services. A fixture
 * should be cheap and should not drag a handle policy, an age gate, and a mail
 * server into a test about uploads — and going through the service would test
 * the service, which is somebody else's suite.
 *
 * What they are not is a substitute for the real thing. A test *about*
 * account creation still creates accounts the way the application does.
 */

/**
 * An Identity with nothing attached: no address, no password, no Session.
 *
 * @param dataSource - The database under test.
 * @returns The new Identity's identifier.
 */
export async function createIdentity(dataSource: DataSource): Promise<string> {
  const identityId = randomUUID();

  await dataSource.query(`INSERT INTO identities (identity_id, created_at) VALUES ($1, now())`, [
    identityId,
  ]);

  return identityId;
}

export interface TestUser {
  readonly userId: string;
  readonly identityId: string;
  readonly handle: string;
}

/**
 * A User, and the Identity it belongs to.
 *
 * Preferences and restricted data are deliberately omitted: they are written by
 * account creation, and a test that needs them should say so by inserting them
 * or by creating the account properly. What this provides is a `user_id` that
 * an upload or a Location can legitimately point at.
 *
 * @param dataSource - The database under test.
 * @param handle - Optional. Unique across the whole database, including
 *   previous runs, so it is generated rather than defaulted to something fixed.
 * @returns The User, its Identity, and the handle it holds.
 */
export async function createUser(dataSource: DataSource, handle?: string): Promise<TestUser> {
  const identityId = await createIdentity(dataSource);
  const userId = randomUUID();
  const chosen = handle ?? `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;

  await dataSource.query(
    `INSERT INTO users (user_id, identity_id, handle, display_name, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'Test Person', 'active', now(), now())`,
    [userId, identityId, chosen],
  );

  await dataSource.query(
    `INSERT INTO user_handles (normalized_handle, handle, user_id, assigned_at)
     VALUES ($1, $2, $3, now())`,
    [chosen.toLowerCase(), chosen, userId],
  );

  return { userId, identityId, handle: chosen };
}

/**
 * An upload that has already been checked and accepted.
 *
 * Inserted directly, at the state the media worker would have left it in. A
 * test about Moments should not have to run a decoder over a real file to
 * obtain a piece of media — that path has its own suite, and reproducing it
 * here would test the upload lifecycle again rather than the thing under test.
 *
 * @param dataSource - The database under test.
 * @param ownerUserId - Who registered it. Only they may build a Moment from it.
 * @param kind - Whether it stands for an image or a video.
 * @returns The new upload's identifier.
 */
export async function createReadyUpload(
  dataSource: DataSource,
  ownerUserId: string,
  kind: "image" | "video" = "image",
): Promise<string> {
  const uploadId = randomUUID();

  await dataSource.query(
    `INSERT INTO uploads (
       upload_id, owner_user_id, kind, declared_content_type, declared_byte_size,
       storage_key, state, media_kind, byte_size, content_type,
       width, height, checked_at, registered_at, expires_at, updated_at
     ) VALUES ($1, $2, $3, $4, 1024, $5, 'ready', $3, 1024, $4,
               100, 100, now(), now(), now() + interval '1 hour', now())`,
    [
      uploadId,
      ownerUserId,
      kind,
      kind === "image" ? "image/jpeg" : "video/mp4",
      `test/${uploadId}`,
    ],
  );

  return uploadId;
}

/**
 * An upload that has been registered but not yet checked.
 *
 * The state a file is in between being announced and being opened by a decoder.
 * A Moment must refuse it: media is mandatory, so building on a file that might
 * still fail would produce a Moment that could not have been created.
 *
 * @param dataSource - The database under test.
 * @param ownerUserId - Who registered it.
 * @returns The new upload's identifier.
 */
export async function createPendingUpload(
  dataSource: DataSource,
  ownerUserId: string,
): Promise<string> {
  const uploadId = randomUUID();

  await dataSource.query(
    `INSERT INTO uploads (
       upload_id, owner_user_id, kind, declared_content_type, declared_byte_size,
       storage_key, state, registered_at, expires_at, updated_at
     ) VALUES ($1, $2, 'image', 'image/jpeg', 1024, $3, 'registered',
               now(), now() + interval '1 hour', now())`,
    [uploadId, ownerUserId, `test/${uploadId}`],
  );

  return uploadId;
}

/**
 * A recorded place.
 *
 * Inserted directly, because a test about Moments should not have to drive a
 * map-service search to obtain somewhere for something to have happened.
 *
 * @param dataSource - The database under test.
 * @param recordedByUserId - Who first recorded it. Provenance, not ownership:
 *   anybody's Moment may point at it (ADR-098).
 * @returns The new place's identifier.
 */
export async function createLocation(
  dataSource: DataSource,
  recordedByUserId: string,
): Promise<string> {
  const locationId = randomUUID();

  await dataSource.query(
    `INSERT INTO locations (
       location_id, recorded_by_user_id, name, latitude, longitude,
       precision, source, created_at, updated_at
     ) VALUES ($1, $2, $3, 40.7505, -73.9934, 'exact', 'explicit-selection', now(), now())`,
    [locationId, recordedByUserId, `Somewhere ${locationId.slice(0, 8)}`],
  );

  return locationId;
}

/**
 * A recorded real-world Event.
 *
 * @param dataSource - The database under test.
 * @param createdByUserId - Who first recorded it. Provenance, not ownership.
 * @param name - Optional. Names are not unique and are not identity, so one is
 *   generated rather than defaulted to something fixed.
 * @returns The new occurrence's identifier.
 */
export async function createRealWorldEvent(
  dataSource: DataSource,
  createdByUserId: string,
  name?: string,
): Promise<string> {
  const realWorldEventId = randomUUID();

  await dataSource.query(
    `INSERT INTO real_world_events (
       real_world_event_id, created_by_user_id, name,
       occurrence_start, occurrence_end, occurrence_precision, created_at, updated_at
     ) VALUES ($1, $2, $3, '2026-11-20T00:00:00Z', '2026-11-22T23:59:59Z', 'day', now(), now())`,
    [realWorldEventId, createdByUserId, name ?? `Occurrence ${realWorldEventId.slice(0, 8)}`],
  );

  return realWorldEventId;
}
