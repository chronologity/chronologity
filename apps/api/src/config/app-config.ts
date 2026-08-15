import { parseEnv } from "@chronologity/config";
import { toAuthConfig, type AuthConfig } from "./auth-config.js";
import { toDatabaseConfig, type DatabaseConfig } from "./database-config.js";
import { toEmailConfig, type EmailConfig } from "./email-config.js";
import { envSchema, type Env } from "./env.js";
import { toEventStoreConfig, type EventStoreConfig } from "./eventstore-config.js";
import { toMessagingConfig, type MessagingConfig } from "./messaging-config.js";

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
  readonly database: DatabaseConfig;
  readonly eventStore: EventStoreConfig;
  readonly messaging: MessagingConfig;
  readonly auth: AuthConfig;
  readonly email: EmailConfig;
}

/**
 * Load configuration, failing fast when the environment is invalid.
 *
 * Throws `ConfigurationError` listing every problem at once. The process is
 * expected to exit rather than start in an unknown state.
 */
export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const env = parseEnv(envSchema, source);

  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    host: env.API_HOST,
    port: env.API_PORT,
    database: toDatabaseConfig(env),
    eventStore: toEventStoreConfig(env),
    messaging: toMessagingConfig(env),
    auth: toAuthConfig(env),
    email: toEmailConfig(env),
  };
}
