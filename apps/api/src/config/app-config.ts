import { parseEnv } from "@chronologity/config";
import type { ClickHouseConfig } from "./clickhouse-config.js";
import { toAuthConfig, type AuthConfig } from "./auth-config.js";
import { toDatabaseConfig, type DatabaseConfig } from "./database-config.js";
import { toEmailConfig, type EmailConfig } from "./email-config.js";
import { envSchema, type Env } from "./env.js";
import { toMessagingConfig, type MessagingConfig } from "./messaging-config.js";
import { toOutboxConfig, type OutboxConfig } from "./outbox-config.js";
import { toRetentionConfig, type RetentionConfig } from "./retention-config.js";
import { toPlacesConfig, type PlacesConfig } from "./places-config.js";
import {
  toStorageConfig,
  toUploadLimits,
  type StorageConfig,
  type UploadLimits,
} from "./storage-config.js";

/**
 * The API's fully assembled configuration.
 *
 * Assembled once at startup and passed explicitly from there. Nothing reads
 * the environment after this point.
 */
export interface AppConfig {
  readonly nodeEnv: Env["NODE_ENV"];
  readonly logLevel: Env["LOG_LEVEL"];
  readonly host: string;
  readonly port: number;
  /** How many requests one client may make in a minute, across every endpoint. */
  readonly rateLimit: { readonly maxPerMinute: number };
  readonly database: DatabaseConfig;
  /** Where Timeline read models live. Derived; authoritative for nothing. */
  readonly clickhouse: ClickHouseConfig;
  readonly messaging: MessagingConfig;
  readonly outbox: OutboxConfig;
  readonly retention: RetentionConfig;
  readonly auth: AuthConfig;
  /** Minimum age, in whole years, for creating an account. */
  readonly minimumAgeYears: number;
  readonly email: EmailConfig;
  readonly storage: StorageConfig;
  readonly places: PlacesConfig;
  readonly uploadLimits: UploadLimits;
}

/**
 * Load configuration, failing fast when the environment is invalid.
 *
 * Throws `ConfigurationError` listing every problem at once. The process is
 * expected to exit rather than start in an unknown state.
 *
 * @param source - Where to read from. Defaults to the process environment;
 *   injectable so tests need not mutate it.
 * @returns The assembled configuration.
 * @throws {ConfigurationError} If anything is missing or invalid, listing every
 *   problem at once. The process is expected to exit rather than start in an
 *   unknown state.
 */
export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const env = parseEnv(envSchema, source);

  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    host: env.API_HOST,
    port: env.API_PORT,
    rateLimit: { maxPerMinute: env.API_RATE_LIMIT_PER_MINUTE },
    clickhouse: {
      url: env.CLICKHOUSE_URL,
      database: env.CLICKHOUSE_DATABASE,
      username: env.CLICKHOUSE_USERNAME,
      password: env.CLICKHOUSE_PASSWORD,
    },
    database: toDatabaseConfig(env),
    messaging: toMessagingConfig(env),
    outbox: toOutboxConfig(env),
    retention: toRetentionConfig(env),
    auth: toAuthConfig(env),
    minimumAgeYears: env.USER_MINIMUM_AGE_YEARS,
    email: toEmailConfig(env),
    storage: toStorageConfig(env),
    places: toPlacesConfig(env),
    uploadLimits: toUploadLimits(env),
  };
}
