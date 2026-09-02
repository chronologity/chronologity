import type { DataSource } from "typeorm";
import type { AuthConfig } from "../../config/auth-config.js";
import type { AuthRateLimits } from "./authentication.rate-limits.js";
import type { IdentityService } from "./identity.service.js";
import type { PhoneService } from "./phone.service.js";
import type { SessionService } from "./session.service.js";

/** Feature-local types for authentication. */

/**
 * A Session as stored.
 *
 * Read from the row rather than replayed, because the row is the authority
 * (ADR-094). Carries only what a decision needs: whose it is, which credential
 * is current, and the two facts that can end it.
 */
export interface SessionRecord {
  readonly sessionId: string;
  readonly identityId: string;
  /**
   * Hash of the refresh credential currently valid for this Session.
   *
   * Null for a Session created before the column existed. A null never equals
   * a presented hash, so such a Session cannot be refreshed.
   */
  readonly refreshTokenHash: string | null;
  /** Increments on every rotation, so replaying a superseded credential is legible. */
  readonly refreshGeneration: number;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

/** Everything established when a Session begins. */
export interface NewSession {
  readonly sessionId: string;
  readonly identityId: string;
  readonly refreshTokenHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  /** A short description of the client, when it sent one. */
  readonly clientKind: string | undefined;
}

/** Why a refresh was refused. Never reported to the caller; all four are one 401. */
export type RefreshRejection =
  | "session_not_found"
  | "session_revoked"
  | "session_expired"
  | "refresh_token_mismatch";

/**
 * What the API needs in order to authenticate anyone.
 *
 * The routes need both services and the endpoint limits; the plugin that
 * authenticates requests needs Session validation, the signing configuration,
 * and the DataSource the User and role lookups read through. Passed explicitly rather
 * than resolved from a container, so what authentication requires is visible
 * where it is assembled.
 */
export interface AuthenticationWiring {
  readonly identities: IdentityService;
  readonly sessions: SessionService;
  /**
   * Signing in with a phone number.
   *
   * Optional so an application can be built without it — the phone endpoints
   * need an SMS adapter, and a test that has nothing to do with phones should
   * not have to supply one.
   */
  readonly phones?: PhoneService | undefined;
  readonly config: AuthConfig;
  readonly dataSource: DataSource;
  /** Overrides the default endpoint limits. */
  readonly rateLimits?: AuthRateLimits | undefined;
}
