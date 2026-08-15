import { withTransaction } from "../../../lib/database/transaction.js";
import { NotFoundError } from "../../../lib/errors/not-found-error.js";
import type { RequestContext } from "../../../types/request-context.js";
import type { UserDependencies } from "../dependencies.js";
import { readCurrentUser, recordPreferencesUpdated } from "../utils/user-read-model.js";
import type { UpdatePreferencesCommand } from "./update-preferences.command.js";

/**
 * Change preferences.
 *
 * Preferences are not event sourced. They record what someone wants the
 * product to do next, not something that happened, and a permanent history of
 * every toggle would be a privacy liability rather than an asset. The current
 * value is the whole truth.
 *
 * @param deps - Database.
 * @param command - Whose preferences, and which to change.
 * @param _context - Unused; kept so every handler has one shape.
 * @returns Nothing.
 * @throws {NotFoundError} If there is no such User.
 */
export async function handleUpdatePreferences(
  deps: UserDependencies,
  command: UpdatePreferencesCommand,
  _context: RequestContext,
): Promise<void> {
  const { userId, preferences } = command.payload;

  const existing = await readCurrentUser(deps.pool, userId);

  if (existing === undefined) {
    throw new NotFoundError("No such account");
  }

  await withTransaction(deps.pool, (tx) => recordPreferencesUpdated(tx, userId, preferences));
}
