import type { CurrentUser } from "@chronologity/contracts";

/** Feature-local types for users. */

/**
 * A User's own account, minus restricted data.
 *
 * Restricted data is fetched separately and on purpose, so that it can never
 * arrive as a by-product of reading a profile.
 */
export type UserAccountView = Omit<CurrentUser, "dateOfBirth">;

/**
 * The stored state a decision is made against.
 *
 * Read from the row rather than replayed, because the row is the authority
 * (ADR-092). Carries only what a decision needs: how somebody presents
 * themselves, and whether their account is usable.
 */
export interface UserState {
  readonly userId: string;
  readonly handle: string;
  readonly displayName: string;
  readonly biography: string | null;
  readonly status: "active" | "deactivated";
}
