import { booleanSchema, logLevelSchema, nodeEnvSchema, portSchema } from "@chronologity/config";
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

  // OWASP's recommended Argon2id floor. Configurable so cost can be raised
  // as hardware improves without a code change; stored hashes carry their own
  // parameters, so raising these migrates people gradually rather than
  // invalidating them.
  AUTH_PASSWORD_MEMORY_COST_KIB: z.coerce.number().int().min(8_192).default(19_456),
  AUTH_PASSWORD_TIME_COST: z.coerce.number().int().min(1).default(2),
  AUTH_PASSWORD_PARALLELISM: z.coerce.number().int().min(1).default(1),
  // Length is the control that matters; composition rules are deliberately absent.
  AUTH_PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(12),
  AUTH_PASSWORD_MAX_LENGTH: z.coerce.number().int().max(1_024).default(256),

  // A legal question rather than a technical one, and it differs by
  // jurisdiction. Thirteen matches COPPA; the European Union sets sixteen with
  // member states free to lower it to thirteen.
  USER_MINIMUM_AGE_YEARS: z.coerce.number().int().min(0).max(25).default(13),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: portSchema,
  SMTP_FROM: z.email(),

  // The public OpenStreetMap service. Chosen because it is the only major
  // provider whose terms permit storing a place's name permanently, which
  // Chronologity requires to keep historical names (ADR-090).
  PLACES_ENDPOINT: z.url().default("https://nominatim.openstreetmap.org/search"),
  // Required by OpenStreetMap's usage policy: requests must identify the
  // application, not merely a library.
  PLACES_USER_AGENT: z.string().min(1).default("Chronologity/0.1 (development)"),
  // The public service asks for no more than one request a second. It is
  // maintained by volunteers.
  PLACES_MINIMUM_INTERVAL_MS: z.coerce.number().int().min(0).max(10_000).default(1_100),

  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  // SeaweedFS and most S3-compatible servers address buckets by path; AWS does
  // not, so this cannot be inferred from the endpoint.
  S3_FORCE_PATH_STYLE: booleanSchema.default(true),

  // A presigned URL authorises a write. Short-lived by intent, and bounded
  // here so a deployment cannot quietly make it a day.
  S3_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
  UPLOAD_REGISTRATION_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(3_600),
  // Per-file technical limits, not per-Moment media counts (`media.md:266`).
  UPLOAD_MAX_IMAGE_BYTES: z.coerce.number().int().min(1).default(26_214_400),
  UPLOAD_MAX_VIDEO_BYTES: z.coerce.number().int().min(1).default(524_288_000),
});

export type Env = z.infer<typeof envSchema>;
