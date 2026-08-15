import { logLevelSchema, nodeEnvSchema, portSchema } from "@chronologity/config";
import { z } from "zod";

/**
 * The API's environment contract.
 *
 * Every variable the API reads is declared here. Feature code receives typed
 * configuration and never reaches for `process.env` directly, so the set of
 * things a deployment must supply stays knowable from one file.
 *
 * Defaults exist only for values that are safe to guess locally. Credentials
 * and connection targets have none: a missing database URL must stop the
 * process, not silently point it somewhere plausible.
 */
export const envSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema,

  API_HOST: z.string().min(1).default("0.0.0.0"),
  API_PORT: portSchema.default(3000),

  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: portSchema,
  POSTGRES_DATABASE: z.string().min(1),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string(),

  EVENTSTOREDB_URL: z.string().startsWith("esdb://"),

  KAFKA_BROKERS: z.string().min(1),

  // No default for the signing secret: a development fallback would eventually
  // reach an environment nobody re-checked, and a known signing key is a
  // forged session for anyone who has read the repository.
  AUTH_JWT_SECRET: z.string().min(16),
  AUTH_JWT_ISSUER: z.string().min(1).default("chronologity"),
  AUTH_JWT_AUDIENCE: z.string().min(1).default("chronologity-clients"),
  AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  AUTH_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  AUTH_MAGIC_LINK_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  AUTH_MAGIC_LINK_BASE_URL: z.url(),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: portSchema,
  SMTP_FROM: z.email(),
});

export type Env = z.infer<typeof envSchema>;
