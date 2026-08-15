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
});

export type Env = z.infer<typeof envSchema>;
