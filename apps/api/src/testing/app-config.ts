import type { AppConfig } from "../config/app-config.js";
import { TEST_RETENTION_PERIODS } from "./retention.js";

/**
 * The configuration an integration suite runs against.
 *
 * Every suite needs one and they are all but identical, so each has carried its
 * own copy — which is why adding one field to `AppConfig` once touched fifteen
 * literals. New suites build theirs here instead. The existing copies are left
 * where they are: rewriting fourteen working suites to save a duplication is a
 * change with no test behind it.
 *
 * @param clientId - Names this suite's Kafka client, so a consumer group in a
 *   log can be traced back to the suite that opened it.
 * @returns Configuration pointing at the local stack, with limits raised where
 *   a test drives one process harder than a person ever would.
 */
export function testAppConfig(clientId: string): AppConfig {
  return {
    nodeEnv: "test",
    logLevel: "fatal",
    host: "127.0.0.1",
    port: 0,
    // Raised well above the production ceiling: a suite drives one process
    // through hundreds of requests in a minute, which is not the traffic the
    // limiter defends against.
    rateLimit: { maxPerMinute: 100_000 },
    database: {
      host: process.env.POSTGRES_HOST ?? "localhost",
      port: Number(process.env.POSTGRES_PORT ?? "5432"),
      database: process.env.POSTGRES_DATABASE ?? "chronologity",
      user: process.env.POSTGRES_USER ?? "chronologity",
      password: process.env.POSTGRES_PASSWORD ?? "chronologity",
    },
    messaging: { brokers: ["localhost:9092"], clientId },
    outbox: { retentionMs: 0 },
    retention: { periods: TEST_RETENTION_PERIODS },
    auth: {
      jwtSecret: new TextEncoder().encode("integration-test-secret-long-enough-for-hs256"),
      issuer: "chronologity",
      audience: "chronologity-clients",
      accessTokenTtlSeconds: 600,
      refreshTokenTtlSeconds: 2_592_000,
      magicLinkTtlSeconds: 900,
      phoneCodeTtlSeconds: 300,
      magicLinkBaseUrl: "http://localhost:3000/auth/sessions",
      // Deliberately weak. Argon2id at production cost would spend minutes of
      // every run proving a property the authentication suite proves once.
      passwordHashing: { memoryCostKib: 8_192, timeCost: 1, parallelism: 1 },
      passwordPolicy: { minimumLength: 12, maximumLength: 256 },
    },
    minimumAgeYears: 13,
    storage: {
      endpoint: process.env.S3_ENDPOINT ?? "http://127.0.0.1:8333",
      region: process.env.S3_REGION ?? "us-east-1",
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "chronologity",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "chronologity-local-secret",
      bucket: process.env.S3_BUCKET ?? "chronologity-media",
      forcePathStyle: true,
      uploadUrlTtlSeconds: 900,
    },
    uploadLimits: {
      registrationTtlSeconds: 3_600,
      maxImageBytes: 26_214_400,
      maxVideoBytes: 524_288_000,
    },
    places: {
      endpoint: "https://nominatim.openstreetmap.org/search",
      userAgent: "Chronologity/0.1 (test)",
      minimumIntervalMs: 0,
      reverseEndpoint: "https://nominatim.openstreetmap.org/reverse",
    },
    email: {
      host: process.env.SMTP_HOST ?? "localhost",
      port: Number(process.env.SMTP_PORT ?? "1025"),
      from: process.env.SMTP_FROM ?? "no-reply@chronologity.local",
    },
  };
}

/** Where the local mail sink can be read. */
export const MAILPIT = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? "8025"}`;
