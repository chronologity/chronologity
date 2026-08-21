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
