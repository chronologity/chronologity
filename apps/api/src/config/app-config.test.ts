import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "./app-config.js";

/**
 * The environment contract.
 *
 * Configuration is validated once, at startup, and the process is expected to
 * exit rather than begin in an unknown state. Several of these rules are not
 * ergonomics but security bounds — how long a presigned upload URL may live,
 * how weak a password policy a deployment may configure — and a bound nothing
 * checks is a bound that will be wrong the first time somebody edits it.
 */

/** The smallest environment that starts the API. Everything else has a default. */
const required = (): Record<string, string> => ({
  NODE_ENV: "test",
  LOG_LEVEL: "info",
  POSTGRES_HOST: "localhost",
  POSTGRES_PORT: "5432",
  POSTGRES_DATABASE: "chronologity",
  POSTGRES_USER: "chronologity",
  POSTGRES_PASSWORD: "chronologity",
  KAFKA_BROKERS: "localhost:9092",
  AUTH_JWT_SECRET: "a-secret-long-enough-to-be-accepted",
  AUTH_MAGIC_LINK_BASE_URL: "https://app.example.test/auth/sessions",
  SMTP_HOST: "localhost",
  SMTP_PORT: "1025",
  SMTP_FROM: "no-reply@example.test",
  S3_ENDPOINT: "https://storage.example.test",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
  S3_BUCKET: "media",
});

const withEnv = (over: Record<string, string | undefined>) => ({ ...required(), ...over });

/** The issues reported for an environment, or a failure if it was accepted. */
const issuesFor = (source: Record<string, string | undefined>): readonly string[] => {
  try {
    loadConfig(source);
  } catch (error) {
    assert.ok(error instanceof ConfigurationError);
    return error.issues;
  }

  return assert.fail("expected the configuration to be refused");
};

describe("loadConfig", () => {
  it("assembles configuration from a complete environment", () => {
    const config = loadConfig(required());

    assert.equal(config.nodeEnv, "test");
    assert.equal(config.database.host, "localhost");
    assert.equal(config.database.port, 5432);
    assert.deepEqual(config.messaging.brokers, ["localhost:9092"]);
    assert.equal(config.email.from, "no-reply@example.test");
    assert.equal(config.storage.bucket, "media");
  });

  it("coerces the numbers that arrive as strings", () => {
    // Everything in an environment is a string. A port that stayed one would
    // fail somewhere much less obvious than here.
    const config = loadConfig(withEnv({ POSTGRES_PORT: "5433", API_PORT: "8080" }));

    assert.strictEqual(config.database.port, 5433);
    assert.strictEqual(config.port, 8080);
  });

  it("applies documented defaults where a value is safe to guess", () => {
    const config = loadConfig(required());

    assert.equal(config.host, "0.0.0.0");
    assert.equal(config.port, 3000);
    assert.equal(config.auth.issuer, "chronologity");
    assert.equal(config.minimumAgeYears, 13);
    assert.equal(config.storage.region, "us-east-1");
    assert.equal(config.storage.forcePathStyle, true);
  });

  it("refuses to guess a credential or a connection target", () => {
    // A missing database host must stop the process, not silently point it
    // somewhere plausible.
    for (const key of [
      "POSTGRES_HOST",
      "POSTGRES_DATABASE",
      "POSTGRES_USER",
      "KAFKA_BROKERS",
      "AUTH_JWT_SECRET",
      "S3_ENDPOINT",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "S3_BUCKET",
      "SMTP_HOST",
    ]) {
      const issues = issuesFor(withEnv({ [key]: undefined }));

      assert.ok(
        issues.some((issue) => issue.includes(key)),
        `${key} was accepted as missing, or its absence was not reported`,
      );
    }
  });

  it("reports every problem at once rather than the first", () => {
    // An operator fixing configuration one error per restart is an operator
    // restarting a lot.
    const issues = issuesFor(
      withEnv({ POSTGRES_HOST: undefined, KAFKA_BROKERS: undefined, SMTP_FROM: "not-an-address" }),
    );

    assert.ok(issues.length >= 3, `expected several issues, saw ${issues.length}`);
  });

  it("bounds how long a presigned upload URL may live", () => {
    // A presigned URL authorises a write. The ceiling exists so a deployment
    // cannot quietly turn fifteen minutes into a day.
    assert.equal(
      loadConfig(withEnv({ S3_UPLOAD_URL_TTL_SECONDS: "3600" })).storage.uploadUrlTtlSeconds,
      3600,
    );

    for (const value of ["3601", "86400", "59", "0"]) {
      assert.ok(
        issuesFor(withEnv({ S3_UPLOAD_URL_TTL_SECONDS: value })).some((issue) =>
          issue.includes("S3_UPLOAD_URL_TTL_SECONDS"),
        ),
        `${value} seconds was accepted as an upload URL lifetime`,
      );
    }
  });

  it("bounds how long an upload authorisation stays open", () => {
    assert.equal(
      loadConfig(withEnv({ UPLOAD_REGISTRATION_TTL_SECONDS: "86400" })).uploadLimits
        .registrationTtlSeconds,
      86_400,
    );

    for (const value of ["299", "86401"]) {
      assert.ok(
        issuesFor(withEnv({ UPLOAD_REGISTRATION_TTL_SECONDS: value })).length > 0,
        `${value} was accepted as a registration lifetime`,
      );
    }
  });

  it("refuses a password policy weaker than the floor", () => {
    // The minimum is a floor a deployment may raise, never lower.
    assert.ok(issuesFor(withEnv({ AUTH_PASSWORD_MIN_LENGTH: "7" })).length > 0);
    assert.equal(
      loadConfig(withEnv({ AUTH_PASSWORD_MIN_LENGTH: "8" })).auth.passwordPolicy.minimumLength,
      8,
    );
  });

  it("refuses hashing parameters below the floor", () => {
    // Argon2id is slow on purpose. A deployment that turns the cost down has
    // turned the protection off.
    assert.ok(issuesFor(withEnv({ AUTH_PASSWORD_MEMORY_COST_KIB: "8191" })).length > 0);
    assert.ok(issuesFor(withEnv({ AUTH_PASSWORD_TIME_COST: "0" })).length > 0);
  });

  it("refuses a signing secret short enough to guess", () => {
    assert.ok(issuesFor(withEnv({ AUTH_JWT_SECRET: "short" })).length > 0);
  });

  it("holds the signing secret as bytes rather than a string", () => {
    // So it is never accidentally interpolated into a log line or an error.
    const config = loadConfig(required());

    assert.ok(config.auth.jwtSecret instanceof Uint8Array);
    assert.ok(!JSON.stringify(config.auth).includes("a-secret-long-enough-to-be-accepted"));
  });

  it("refuses a malformed URL or address", () => {
    for (const [key, value] of [
      ["AUTH_MAGIC_LINK_BASE_URL", "not a url"],
      ["S3_ENDPOINT", "storage.example.test"],
      ["SMTP_FROM", "not-an-address"],
      ["PLACES_ENDPOINT", "nominatim"],
    ] as const) {
      assert.ok(issuesFor(withEnv({ [key]: value })).length > 0, `${key}=${value} was accepted`);
    }
  });

  it("keeps the map service's rate limit within what its operators ask for", () => {
    // OpenStreetMap is run by volunteers who ask for no more than one request a
    // second. Zero is permitted for tests that answer from recordings.
    assert.equal(loadConfig(withEnv({ PLACES_MINIMUM_INTERVAL_MS: "0" })).places.minimumIntervalMs, 0);
    assert.ok(issuesFor(withEnv({ PLACES_MINIMUM_INTERVAL_MS: "10001" })).length > 0);
    assert.equal(loadConfig(required()).places.minimumIntervalMs, 1_100);
  });

  it("bounds the minimum age at something a jurisdiction could plausibly require", () => {
    assert.ok(issuesFor(withEnv({ USER_MINIMUM_AGE_YEARS: "26" })).length > 0);
    assert.equal(loadConfig(withEnv({ USER_MINIMUM_AGE_YEARS: "16" })).minimumAgeYears, 16);
  });

  it("splits a broker list into its members", () => {
    const config = loadConfig(withEnv({ KAFKA_BROKERS: "a:9092,b:9092,c:9092" }));

    assert.deepEqual(config.messaging.brokers, ["a:9092", "b:9092", "c:9092"]);
  });

  it("reads path-style addressing as a boolean, not a truthy string", () => {
    // "false" is a non-empty string. Read carelessly it means true, and the
    // deployment addresses buckets the wrong way with no error.
    assert.equal(loadConfig(withEnv({ S3_FORCE_PATH_STYLE: "false" })).storage.forcePathStyle, false);
    assert.equal(loadConfig(withEnv({ S3_FORCE_PATH_STYLE: "true" })).storage.forcePathStyle, true);
  });
});
