import type { EventStoreDBClient } from "@eventstore/db-client";
import type pg from "pg";
import type { Logger } from "../../lib/logger/logger.js";

/**
 * What User handlers need from the outside world.
 *
 * Passed to each handler rather than resolved from a container, so a handler's
 * dependencies are visible in its signature.
 */
export interface UserDependencies {
  readonly client: EventStoreDBClient;
  readonly pool: pg.Pool;
  readonly logger?: Logger;
  /** Injected so tests can move time without waiting. */
  readonly clock?: () => Date;
  /**
   * How long a released handle stays reserved for its former owner.
   *
   * Configuration because `identity.md:115` leaves the policy open, and
   * because the right number is a product judgement rather than a technical
   * one.
   */
  readonly handleCooldownDays?: number;
  /**
   * Minimum age, in whole years, for creating an account.
   *
   * Configuration because it is a legal question rather than a technical one.
   */
  readonly minimumAgeYears?: number;
}

/** Default reservation period for a released handle. */
export const DEFAULT_HANDLE_COOLDOWN_DAYS = 30;

/** Default minimum age. Matches COPPA; jurisdictions requiring more override it. */
export const DEFAULT_MINIMUM_AGE_YEARS = 13;

/**
 * The clock a handler should use.
 *
 * @param deps - May carry an injected clock.
 * @returns The clock to read time from.
 */
export function clockFor(deps: UserDependencies): () => Date {
  return deps.clock ?? (() => new Date());
}

/**
 * How long a released handle stays reserved.
 *
 * @param deps - May override the default.
 * @returns The cooldown in days.
 */
export function cooldownFor(deps: UserDependencies): number {
  return deps.handleCooldownDays ?? DEFAULT_HANDLE_COOLDOWN_DAYS;
}

/**
 * The minimum age for creating an account.
 *
 * @param deps - May override the default.
 * @returns The minimum, in whole years.
 */
export function minimumAgeFor(deps: UserDependencies): number {
  return deps.minimumAgeYears ?? DEFAULT_MINIMUM_AGE_YEARS;
}
