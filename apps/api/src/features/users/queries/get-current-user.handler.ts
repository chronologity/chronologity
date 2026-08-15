import type { CurrentUser } from "@chronologity/contracts";
import { NotFoundError } from "../../../lib/errors/not-found-error.js";
import type { UserDependencies } from "../dependencies.js";
import { readDateOfBirth } from "../utils/restricted-data-store.js";
import { readCurrentUser } from "../utils/user-read-model.js";
import type { GetCurrentUserQuery } from "./get-current-user.query.js";

/**
 * Read the signed-in person's own account, including their preferences.
 *
 * Returns a deactivated account, unlike the public view: its owner needs to
 * see that state in order to reactivate it.
 *
 * @param deps - Database.
 * @param query - Which User.
 * @returns Their own view of their account.
 * @throws {NotFoundError} If there is no such User.
 * @throws {Error} If the account has no date of birth recorded, which cannot
 *   happen for an account created through onboarding.
 */
export async function handleGetCurrentUser(
  deps: UserDependencies,
  query: GetCurrentUserQuery,
): Promise<CurrentUser> {
  const user = await readCurrentUser(deps.pool, query.userId);

  if (user === undefined) {
    throw new NotFoundError("No such account");
  }

  // Read separately because it lives in a separate table, which is the point:
  // it cannot arrive by accident in a query written for the profile.
  const dateOfBirth = await readDateOfBirth(deps.pool, query.userId);

  if (dateOfBirth === undefined) {
    // Recorded in the same transaction that creates the account, so its absence
    // is not a missing optional field: it is an account that should not exist.
    // Better to fail loudly than to answer with a plausible blank.
    throw new Error(`No restricted data recorded for user ${query.userId}`);
  }

  return { ...user, dateOfBirth };
}
