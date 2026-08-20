import type pg from "pg";
import type { AuthConfig } from "../config/auth-config.js";
import { IdentityRepository } from "../features/authentication/identity.repository.js";
import { IdentityService } from "../features/authentication/identity.service.js";
import { SessionRepository } from "../features/authentication/session.repository.js";
import { SessionService } from "../features/authentication/session.service.js";
import type { AuthenticationWiring } from "../features/authentication/authentication.types.js";
import { createEmailClient } from "../integrations/email/email-client.js";
import type { EmailConfig } from "../config/email-config.js";
import { UserRepository } from "../features/users/user.repository.js";

/**
 * Authentication wired the way the process wires it, for integration tests.
 *
 * Every suite that needs an authenticated caller assembles the same four
 * objects, and assembling them differently from `main.ts` would leave the
 * arrangement that actually ships untested. This is that arrangement, with two
 * concessions to testing: an injectable clock, and limits raised far above
 * anything a suite will reach except the one test that reaches them on purpose.
 */

/** Headroom, so a suite never trips a limit it is not testing. */
const UNLIMITED = {
  magicLinkRequestsPerWindow: 1000,
  sessionCreationsPerWindow: 1000,
  passwordAttemptsPerWindow: 1000,
  registrationsPerWindow: 1000,
  windowMinutes: 15,
} as const;

export interface TestAuthentication extends AuthenticationWiring {
  /** Closed by the suite that built it; nothing else owns the connection. */
  close(): Promise<void>;
}

/**
 * Build authentication against real infrastructure.
 *
 * @param pool - The database this suite runs against.
 * @param config - Authentication settings.
 * @param email - Where to reach the local mail server.
 * @param clock - Optional. Injected so a test can move time without waiting.
 * @returns The wiring `buildApp` takes, plus the means to close the mail
 *   connection it opened.
 */
export function createTestAuthentication(
  pool: pg.Pool,
  config: AuthConfig,
  email: EmailConfig,
  clock?: () => Date,
): TestAuthentication {
  const mail = createEmailClient(email);
  const now = clock ?? (() => new Date());

  const sessions = new SessionService(
    pool,
    new SessionRepository(pool),
    new UserRepository(pool),
    config,
    now,
  );

  return {
    identities: new IdentityService(
      pool,
      new IdentityRepository(pool),
      sessions,
      mail,
      config,
      now,
    ),
    sessions,
    config,
    pool,
    rateLimits: UNLIMITED,
    close: () => mail.close(),
  };
}
