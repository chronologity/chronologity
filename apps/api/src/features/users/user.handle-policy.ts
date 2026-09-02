/**
 * What Chronologity accepts as a handle.
 *
 * A handle is how one person refers to another, so the rules exist to stop two
 * accounts being confusable rather than to enforce taste. Case is not
 * significant: `@Richard` and `@richard` must not be different people
 * (`identity.md:86`).
 */

/** Bounds. Short enough to type, long enough to be someone's actual name. */
export const HANDLE_MINIMUM_LENGTH = 3;
export const HANDLE_MAXIMUM_LENGTH = 30;

const HANDLE_PATTERN = /^[a-zA-Z0-9_]+$/;

/**
 * Handles nobody may claim.
 *
 * Two reasons, and they are different. Some would collide with paths the API
 * or a future client uses, so a profile at that handle would be unreachable or
 * ambiguous. Others invite impersonation — an account at `@support` is
 * believed in a way `@dave` is not. `identity.md:342` permits reserving both.
 */
const RESERVED_HANDLES = new Set([
  // Route collisions.
  "api",
  "admin",
  "auth",
  "login",
  "logout",
  "signin",
  "signup",
  "register",
  "settings",
  "search",
  "explore",
  "feed",
  "timeline",
  "moments",
  "users",
  "user",
  "me",
  "new",
  "edit",
  "delete",
  "static",
  "assets",
  "media",
  "health",
  "status",
  "graphql",
  "www",
  // Believability.
  "support",
  "help",
  "helpdesk",
  "security",
  "billing",
  "payments",
  "moderation",
  "moderator",
  "team",
  "staff",
  "official",
  "verified",
  "chronologity",
  "root",
  "system",
  "noreply",
  "no_reply",
  "postmaster",
  "abuse",
]);

export type HandleRejection = "too_short" | "too_long" | "invalid_characters" | "reserved";

export type HandleCheck =
  | { readonly ok: true; readonly normalized: string }
  | { readonly ok: false; readonly reason: HandleRejection };

/**
 * Reduce a handle to the form uniqueness is decided on.
 *
 * @param handle - The handle as typed.
 * @returns Its lowercased, trimmed form. Comparison only: the handle is stored
 *   and displayed exactly as chosen, because how someone capitalises their own
 *   name is theirs to decide.
 */
export function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

/**
 * Decide whether a handle may be claimed.
 *
 * Answers only about the handle itself. Whether it is already held by someone
 * is a question for the database, which is the only thing that can answer it
 * without racing.
 *
 * @param handle - The handle as typed.
 * @returns The normalised form, or the reason it was refused.
 */
export function checkHandle(handle: string): HandleCheck {
  const trimmed = handle.trim();

  if (trimmed.length < HANDLE_MINIMUM_LENGTH) {
    return { ok: false, reason: "too_short" };
  }

  if (trimmed.length > HANDLE_MAXIMUM_LENGTH) {
    return { ok: false, reason: "too_long" };
  }

  if (!HANDLE_PATTERN.test(trimmed)) {
    return { ok: false, reason: "invalid_characters" };
  }

  const normalized = normalizeHandle(trimmed);

  if (RESERVED_HANDLES.has(normalized)) {
    // Reported the same as "already taken" by the caller: whether a handle is
    // reserved or merely held is not information anyone needs, and revealing
    // it maps out the reserved list.
    return { ok: false, reason: "reserved" };
  }

  return { ok: true, normalized };
}

/**
 * What to tell someone whose handle was refused.
 *
 * @param reason - Why it was refused.
 * @returns A sentence safe to show them. "Reserved" and "taken" deliberately
 *   read the same.
 */
export function describeHandleRejection(reason: HandleRejection): string {
  switch (reason) {
    case "too_short":
      return `A handle must be at least ${HANDLE_MINIMUM_LENGTH} characters`;
    case "too_long":
      return `A handle must be at most ${HANDLE_MAXIMUM_LENGTH} characters`;
    case "invalid_characters":
      return "A handle may contain letters, numbers, and underscores, and nothing else";
    default:
      // Covers "reserved", and anything a later change adds. Whether a handle
      // is reserved or merely held is not information anyone needs, and
      // revealing which maps out the reserved list.
      return "That handle is not available";
  }
}

/** Why a handle could not be claimed. Both are reported to the caller identically. */
export type HandleClaimFailure = "taken" | "reserved_by_cooldown";

export type HandleClaim =
  { readonly ok: true } | { readonly ok: false; readonly reason: HandleClaimFailure };

/**
 * Whether a handle somebody has given up may be claimed now.
 *
 * Handles given up are kept rather than deleted. Releasing one for immediate
 * reassignment invites impersonation and breaks references
 * (`identity.md:113`), so a former handle stays reserved for its original
 * owner for a cooldown. The exact period is configuration, because the policy
 * is explicitly open.
 *
 * @param released - When the previous holder gave it up.
 * @param previousHolderUserId - Who held it before.
 * @param claimantUserId - Who wants it now.
 * @param cooldownDays - How long a released handle stays reserved.
 * @param now - The current instant.
 * @returns True if the claim may proceed. A User reclaiming their own former
 *   handle may always do so, even mid-cooldown: the cooldown exists to protect
 *   them from somebody else, not from themselves.
 */
export function mayClaimReleasedHandle(
  released: Date,
  previousHolderUserId: string,
  claimantUserId: string,
  cooldownDays: number,
  now: Date,
): boolean {
  if (previousHolderUserId === claimantUserId) {
    return true;
  }

  const reservedUntil = new Date(released.getTime() + cooldownDays * 24 * 60 * 60 * 1000);

  return reservedUntil <= now;
}
