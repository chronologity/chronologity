import type { EmailAdded } from "../events/email-added.event.js";
import type { EmailVerified } from "../events/email-verified.event.js";
import type { IdentityCreated } from "../events/identity-created.event.js";
import type { PasswordSet } from "../events/password-set.event.js";

/**
 * Identity — the durable authentication identity behind an account.
 *
 * Identity owns how someone proves who they are: verified email addresses and,
 * later, linked providers. It does not own the profile, the display name, or
 * anything a person chooses about themselves; that belongs to User.
 *
 * Nothing secret is ever recorded here. Magic-link tokens and credentials live
 * in short-lived relational rows, because event history is permanent and a
 * secret in permanent history is a secret you cannot rotate away.
 */

export const IDENTITY_CATEGORY = "identity";

export interface IdentityEmail {
  readonly email: string;
  readonly normalizedEmail: string;
  readonly verified: boolean;
}

export interface IdentityState {
  readonly exists: boolean;
  readonly identityId: string | undefined;
  readonly emails: readonly IdentityEmail[];
  readonly createdAt: string | undefined;
  /**
   * Whether a password credential exists.
   *
   * The hash itself lives in PostgreSQL; history records only that one was
   * set, and when.
   */
  readonly hasPassword: boolean;
}

/** Everything that can happen to an Identity. */
export type IdentityEvent = IdentityCreated | EmailAdded | EmailVerified | PasswordSet;

export const initialIdentityState: IdentityState = {
  exists: false,
  identityId: undefined,
  emails: [],
  createdAt: undefined,
  hasPassword: false,
};

/**
 * Normalise an email for identity resolution.
 *
 * Deliberately conservative: lowercase and trim, nothing more. Aggressive
 * normalisation — stripping dots, cutting everything after a plus sign — is
 * provider-specific, and applying it universally silently merges addresses
 * that belong to different people.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Rebuild Identity state from its history. Pure, so replay is deterministic. */
export function evolveIdentity(state: IdentityState, event: IdentityEvent): IdentityState {
  switch (event.type) {
    case "IdentityCreated":
      return {
        ...state,
        exists: true,
        identityId: event.payload.identityId,
        createdAt: event.payload.createdAt,
      };

    case "EmailAdded": {
      if (state.emails.some((entry) => entry.normalizedEmail === event.payload.normalizedEmail)) {
        return state;
      }

      return {
        ...state,
        emails: [
          ...state.emails,
          {
            email: event.payload.email,
            normalizedEmail: event.payload.normalizedEmail,
            verified: false,
          },
        ],
      };
    }

    case "EmailVerified":
      return {
        ...state,
        emails: state.emails.map((entry) =>
          entry.normalizedEmail === event.payload.normalizedEmail
            ? { ...entry, verified: true }
            : entry,
        ),
      };

    case "PasswordSet":
      return { ...state, hasPassword: true };

    default:
      // History outlives code: an unrecognised event is skipped, not fatal.
      return state;
  }
}

/** Whether this Identity has proven control of an address. */
export function hasVerifiedEmail(state: IdentityState, normalizedEmail: string): boolean {
  return state.emails.some((entry) => entry.normalizedEmail === normalizedEmail && entry.verified);
}

export type IdentityDecision =
  | { readonly ok: true; readonly events: readonly IdentityEvent[] }
  | { readonly ok: false; readonly reason: IdentityRejection };

export type IdentityRejection =
  | "identity_already_exists"
  | "identity_not_found"
  | "email_already_added"
  | "email_not_found"
  | "email_already_verified";

/**
 * Create an Identity with its first email.
 *
 * Whether that address is already verified depends on how the Identity came to
 * exist, so the caller must say. Redeeming a magic link is itself proof of
 * control and arrives verified; registering with a password proves nothing
 * about the address yet, and must be confirmed before it can be used to sign
 * in (`authentication.md:240`).
 */
export function decideCreateIdentity(
  state: IdentityState,
  input: { identityId: string; email: string; emailVerified: boolean; now: Date },
): IdentityDecision {
  if (state.exists) {
    return { ok: false, reason: "identity_already_exists" };
  }

  const normalizedEmail = normalizeEmail(input.email);
  const timestamp = input.now.toISOString();

  const events: IdentityEvent[] = [
    {
      type: "IdentityCreated",
      payload: { identityId: input.identityId, createdAt: timestamp },
    },
    {
      type: "EmailAdded",
      payload: { email: input.email, normalizedEmail },
    },
  ];

  if (input.emailVerified) {
    events.push({
      type: "EmailVerified",
      payload: { normalizedEmail, verifiedAt: timestamp },
    });
  }

  return { ok: true, events };
}

/**
 * Record that a password credential was set.
 *
 * Setting a password over an existing one is legitimate — that is what a reset
 * and a change both are — so this does not refuse an Identity that already has
 * one. The hash is written to PostgreSQL by the handler; only the fact reaches
 * history.
 */
export function decideSetPassword(
  state: IdentityState,
  input: { algorithm: string; reason: "registration" | "reset" | "change"; now: Date },
): IdentityDecision {
  if (!state.exists) {
    return { ok: false, reason: "identity_not_found" };
  }

  return {
    ok: true,
    events: [
      {
        type: "PasswordSet",
        payload: {
          algorithm: input.algorithm,
          reason: input.reason,
          setAt: input.now.toISOString(),
        },
      },
    ],
  };
}

/** Add a further address to an existing Identity, unverified until proven. */
export function decideAddEmail(state: IdentityState, input: { email: string }): IdentityDecision {
  if (!state.exists) {
    return { ok: false, reason: "identity_not_found" };
  }

  const normalizedEmail = normalizeEmail(input.email);

  if (state.emails.some((entry) => entry.normalizedEmail === normalizedEmail)) {
    return { ok: false, reason: "email_already_added" };
  }

  return {
    ok: true,
    events: [{ type: "EmailAdded", payload: { email: input.email, normalizedEmail } }],
  };
}

/** Record proven control of an address already claimed by this Identity. */
export function decideVerifyEmail(
  state: IdentityState,
  input: { email: string; now: Date },
): IdentityDecision {
  if (!state.exists) {
    return { ok: false, reason: "identity_not_found" };
  }

  const normalizedEmail = normalizeEmail(input.email);
  const existing = state.emails.find((entry) => entry.normalizedEmail === normalizedEmail);

  if (existing === undefined) {
    return { ok: false, reason: "email_not_found" };
  }

  if (existing.verified) {
    // Not an error the caller can act on, but re-recording verification would
    // add a second past-tense fact for something that happened once.
    return { ok: false, reason: "email_already_verified" };
  }

  return {
    ok: true,
    events: [
      {
        type: "EmailVerified",
        payload: { normalizedEmail, verifiedAt: input.now.toISOString() },
      },
    ],
  };
}
