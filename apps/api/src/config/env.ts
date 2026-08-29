import { booleanSchema, logLevelSchema, nodeEnvSchema, portSchema } from "@chronologity/config";
import { z } from "zod";
import { TIMELINE_VERSION } from "../features/timeline/timeline-row.js";

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

  KAFKA_BROKERS: z.string().min(1),
  /**
   * How long a published outbox message is kept before it is swept.
   *
   * Long enough that "did we emit that event?" is still answerable when a
   * consumer complains, and short enough that a queue does not quietly become
   * an archive of payloads describing people. Zero is permitted and means
   * sweep as soon as a message is published.
   */
  /**
   * How many requests one client may make in a minute, across every endpoint.
   *
   * The global ceiling, not the tighter per-endpoint limits that protect
   * authentication. It depends on where the process runs and how many replicas
   * share the load, so it is configuration rather than a constant.
   */
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  OUTBOX_RETENTION_HOURS: z.coerce.number().int().min(0).max(8_760).default(72),

  // How long each category of operational residue is kept, in days.
  //
  // Bounded at ten years apiece: a period beyond that is not a retention policy
  // but an absence of one, and it should have to be argued for in code rather
  // than typed into an environment file. Zero is permitted throughout, so a
  // deployment that wants to keep nothing can say so.

  /** Consumed sign-in links and spent phone codes. Kept only to diagnose reuse. */
  RETAIN_SIGN_IN_ARTEFACTS_DAYS: z.coerce.number().int().min(0).max(3_650).default(1),
  /** Social and media notifications somebody has read or put away. */
  RETAIN_READ_NOTIFICATIONS_DAYS: z.coerce.number().int().min(0).max(3_650).default(30),
  /** Social and media notifications, read or not. */
  RETAIN_NOTIFICATIONS_DAYS: z.coerce.number().int().min(0).max(3_650).default(180),
  /**
   * Moderation and security notifications.
   *
   * Longest of the three. The first carries a right of appeal and the second is
   * the record that somebody was told their account changed.
   */
  RETAIN_REQUIRED_NOTIFICATIONS_DAYS: z.coerce.number().int().min(0).max(3_650).default(730),
  /** How long a handled message is remembered, so a redelivery is recognised. */
  RETAIN_NOTIFICATION_DEDUPLICATION_DAYS: z.coerce.number().int().min(0).max(3_650).default(30),
  /** Records of what was delivered where. */
  RETAIN_DELIVERY_RECORDS_DAYS: z.coerce.number().int().min(0).max(3_650).default(30),
  /** How long a device may go unseen before it stops being pushed at. */
  RETIRE_DORMANT_DEVICES_DAYS: z.coerce.number().int().min(0).max(3_650).default(180),
  /** How long a retired device's row is kept, so a dead token stays recognisable. */
  RETAIN_RETIRED_DEVICES_DAYS: z.coerce.number().int().min(0).max(3_650).default(30),
  /**
   * Authentication and authorization audit events.
   *
   * The security records a deletion is allowed to leave behind, and bounded for
   * that reason: retaining data only as long as necessary has to be true of the
   * category most likely to be examined, or it is not a principle.
   */
  RETAIN_AUDIT_EVENTS_DAYS: z.coerce.number().int().min(0).max(3_650).default(730),
  /** Finished erasure and export requests. */
  RETAIN_PRIVACY_REQUESTS_DAYS: z.coerce.number().int().min(0).max(3_650).default(90),

  // No default for the signing secret: a development fallback would eventually
  // reach an environment nobody re-checked, and a known signing key is a
  // forged session for anyone who has read the repository.
  AUTH_JWT_SECRET: z.string().min(16),
  AUTH_JWT_ISSUER: z.string().min(1).default("chronologity"),
  AUTH_JWT_AUDIENCE: z.string().min(1).default("chronologity-clients"),
  AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  AUTH_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  /**
   * How long a code sent by text lasts, in seconds.
   *
   * Five minutes by default. A six-digit code is guessable in a way a magic
   * link is not, so the window it is guessable in stays small.
   */
  AUTH_PHONE_CODE_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(300),
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

  CLICKHOUSE_URL: z.string().min(1),
  CLICKHOUSE_DATABASE: z.string().min(1),
  CLICKHOUSE_USERNAME: z.string().min(1),
  CLICKHOUSE_PASSWORD: z.string().min(1),

  /**
   * Which Timeline projection version this process reads and writes.
   *
   * Defaulted rather than required, because the overwhelmingly common case is
   * one version and an operator should not have to name it. It exists so a
   * second can be built beside the first, validated, and switched to — the
   * cutover `deployment.md:809` prescribes, which until now stopped at
   * "validate" because nothing could be pointed anywhere.
   */
  TIMELINE_PROJECTION_VERSION: z.string().min(1).default(TIMELINE_VERSION),

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

  // Asking what is at a coordinate is a different endpoint from asking what
  // matches a name. Configured separately rather than derived from the search
  // URL by rewriting its last path segment, which would silently break against
  // any deployment that arranges its paths differently.
  PLACES_REVERSE_ENDPOINT: z.url().default("https://nominatim.openstreetmap.org/reverse"),

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
