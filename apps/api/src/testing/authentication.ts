import type { DataSource } from "typeorm";
import type { AuthConfig } from "../config/auth-config.js";
import { IdentityRepository } from "../features/authentication/identity.repository.js";
import { IdentityService } from "../features/authentication/identity.service.js";
import { PhoneRepository } from "../features/authentication/phone.repository.js";
import { PhoneService } from "../features/authentication/phone.service.js";
import { SessionRepository } from "../features/authentication/session.repository.js";
import { SessionService } from "../features/authentication/session.service.js";
import type { AuthenticationWiring } from "../features/authentication/authentication.types.js";
import { createEmailClient } from "../integrations/email/email-client.js";
import type { SmsClient } from "../integrations/sms/sms-client.js";
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
  phoneCodeRequestsPerWindow: 1000,
  phoneCodeAttemptsPerWindow: 1000,
  windowMinutes: 15,
} as const;

export interface TestAuthentication extends AuthenticationWiring {
  /** Closed by the suite that built it; nothing else owns the connection. */
  close(): Promise<void>;
  /**
   * Every text the application tried to send, oldest first.
   *
   * Email is read back from Mailpit, so delivery is never stubbed. There is no
   * equivalent for SMS — no provider, and no local gateway to point at — so
   * this records what was handed to the adapter. The boundary being stood in
   * for is a third-party network call, which is where a double is legitimate.
   */
  readonly textsSent: { to: string; text: string }[];
}

/**
 * Build authentication against real infrastructure.
 *
 * @param dataSource - The database this suite runs against.
 * @param config - Authentication settings.
 * @param email - Where to reach the local mail server.
 * @param clock - Optional. Injected so a test can move time without waiting.
 * @returns The wiring `buildApp` takes, plus the means to close the mail
 *   connection it opened.
 */
export function createTestAuthentication(
  dataSource: DataSource,
  config: AuthConfig,
  email: EmailConfig,
  clock?: () => Date,
): TestAuthentication {
  const mail = createEmailClient(email);
  const now = clock ?? (() => new Date());

  const sessions = new SessionService(
    dataSource,
    new SessionRepository(dataSource),
    new UserRepository(dataSource),
    config,
    now,
  );

  const textsSent: { to: string; text: string }[] = [];
  const sms: SmsClient = {
    async send(message) {
      textsSent.push({ to: message.to, text: message.text });

      return Promise.resolve();
    },
  };

  return {
    identities: new IdentityService(
      dataSource,
      new IdentityRepository(dataSource),
      sessions,
      mail,
      config,
      new UserRepository(dataSource),
      now,
    ),
    sessions,
    phones: new PhoneService(
      dataSource,
      new PhoneRepository(dataSource),
      new IdentityRepository(dataSource),
      sessions,
      sms,
      mail,
      config,
      new UserRepository(dataSource),
      now,
    ),
    config,
    dataSource,
    rateLimits: UNLIMITED,
    textsSent,
    close: () => mail.close(),
  };
}
