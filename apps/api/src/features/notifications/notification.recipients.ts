import type { IdentityRepository } from "../authentication/identity.repository.js";
import type { UserRepository } from "../users/user.repository.js";

/**
 * How to reach somebody outside the application.
 *
 * A port rather than a query, because the answer lives in a feature this one
 * does not own. An account holds no address of its own: addresses belong to the
 * Identity that proves who is asking, and the separation between the two is one
 * this system maintains everywhere else. Reaching across it with SQL here would
 * put `identity_emails` in two features' queries and make an erasure path in
 * one of them silently incomplete.
 */
export interface RecipientDirectory {
  /**
   * Where to send an email.
   *
   * @param userId - Whose account.
   * @returns Their verified address, or undefined when there is none. Verified
   *   only: an unverified address is one nobody has proved they can read, and
   *   sending an account's security notifications to it would deliver them to
   *   whoever typed it.
   */
  emailFor(userId: string): Promise<string | undefined>;
}

/**
 * The directory over this system's own storage.
 *
 * Composed from the two repositories that between them know the answer, rather
 * than reading either one's tables directly.
 */
export class StoredRecipientDirectory implements RecipientDirectory {
  /**
   * Build the directory.
   *
   * @param accounts - Resolves an account to the Identity it signs in with.
   * @param identities - Holds the addresses.
   */
  constructor(
    private readonly accounts: UserRepository,
    private readonly identities: IdentityRepository,
  ) {}

  /**
   * Where to send an email.
   *
   * @param userId - Whose account.
   * @returns Their verified address, or undefined when the account has no
   *   Identity, or its Identity has no verified address.
   */
  async emailFor(userId: string): Promise<string | undefined> {
    const identityId = await this.accounts.findIdentityForId(userId);

    return identityId === undefined
      ? undefined
      : this.identities.findVerifiedEmailFor(identityId);
  }
}
