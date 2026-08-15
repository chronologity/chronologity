import type { EventStoreDBClient } from "@eventstore/db-client";
import type pg from "pg";
import type { AuthConfig } from "../../config/auth-config.js";
import type { EmailClient } from "../../integrations/email/email-client.js";
import type { Logger } from "../../lib/logger/logger.js";
import type { AuthRateLimits } from "./rate-limit-policy.js";

/**
 * What authentication handlers need from the outside world.
 *
 * Passed to each handler rather than resolved from a container, so a handler's
 * dependencies are visible in its signature and a test supplies exactly what
 * that handler touches.
 */
export interface AuthDependencies {
  readonly client: EventStoreDBClient;
  readonly pool: pg.Pool;
  readonly config: AuthConfig;
  readonly email: EmailClient;
  readonly logger?: Logger;
  /** Injected so tests can move time without waiting for it. */
  readonly clock?: () => Date;
  /** Overrides the default endpoint limits. */
  readonly rateLimits?: AuthRateLimits | undefined;
}

/** The clock a handler should use. */
export function clockFor(deps: AuthDependencies): () => Date {
  return deps.clock ?? (() => new Date());
}
