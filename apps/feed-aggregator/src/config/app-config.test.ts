import assert from "node:assert/strict";
import { ConfigurationError } from "@chronologity/config";
import { describe, it } from "vitest";
import { loadConfig } from "./app-config.js";

/**
 * The environment contract.
 *
 * Configuration is validated once, at startup, and the process is expected to
 * exit rather than begin in an unknown state. For a read service the failure
 * mode is quieter than a crash and worse: pointed at the wrong ClickHouse, or
 * at a projection version nobody maintains, it answers every query — with
 * somebody else's history, or with history that stopped updating.
 */

/** The smallest environment that starts the aggregator. */
const required = (): Record<string, string> => ({
  NODE_ENV: "test",
  LOG_LEVEL: "info",
  CLICKHOUSE_URL: "http://localhost:8123",
  CLICKHOUSE_DATABASE: "chronologity",
  CLICKHOUSE_USERNAME: "chronologity",
  CLICKHOUSE_PASSWORD: "chronologity",
  TIMELINE_PROJECTION_VERSION: "timeline-v1",
  SEARCH_INDEX_VERSION: "search-v1",
  POSTGRES_HOST: "localhost",
  POSTGRES_PORT: "5432",
  POSTGRES_DATABASE: "chronologity",
  POSTGRES_USER: "chronologity",
  POSTGRES_PASSWORD: "chronologity",
  AUTH_JWT_SECRET: "a-secret-long-enough-to-be-accepted",
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
    assert.equal(config.clickhouse.url, "http://localhost:8123");
    assert.equal(config.clickhouse.projectionVersion, "timeline-v1");
    assert.equal(config.search.indexVersion, "search-v1");
    assert.equal(config.database.host, "localhost");
    assert.equal(config.database.port, 5432);
    assert.equal(config.auth.issuer, "chronologity");
    assert.equal(config.auth.audience, "chronologity-clients");
  });

  it("listens on 4000 by default, so it does not fight the API for 3000", () => {
    const config = loadConfig(required());

    assert.equal(config.host, "0.0.0.0");
    assert.equal(config.port, 4000);
  });

  it("takes a host and port when a deployment supplies them", () => {
    const config = loadConfig(
      withEnv({ FEED_AGGREGATOR_HOST: "127.0.0.1", FEED_AGGREGATOR_PORT: "4100" }),
    );

    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.port, 4100);
  });

  it("holds the signing secret as bytes rather than as a string", () => {
    const config = loadConfig(required());

    assert.ok(config.auth.jwtSecret instanceof Uint8Array);
    assert.deepEqual(
      config.auth.jwtSecret,
      new TextEncoder().encode("a-secret-long-enough-to-be-accepted"),
    );
  });

  it("bounds GraphQL depth, and defaults it", () => {
    const defaulted = loadConfig(required());
    const configured = loadConfig(withEnv({ FEED_AGGREGATOR_GRAPHQL_MAX_DEPTH: "6" }));

    assert.equal(defaulted.graphql.maxDepth, 12);
    assert.equal(configured.graphql.maxDepth, 6);
  });

  it("refuses a depth bound of zero, which would refuse every document", () => {
    const issues = issuesFor(withEnv({ FEED_AGGREGATOR_GRAPHQL_MAX_DEPTH: "0" }));

    assert.ok(issues.some((issue) => issue.startsWith("FEED_AGGREGATOR_GRAPHQL_MAX_DEPTH")));
  });

  it("serves the explorer outside production and not within it", () => {
    const development = loadConfig(withEnv({ NODE_ENV: "development" }));
    const production = loadConfig(withEnv({ NODE_ENV: "production" }));

    assert.equal(development.graphql.graphiql, true);
    assert.equal(production.graphql.graphiql, false);
  });

  it("refuses to start without somewhere to read the Timeline from", () => {
    const issues = issuesFor(withEnv({ CLICKHOUSE_URL: undefined }));

    assert.ok(issues.some((issue) => issue.startsWith("CLICKHOUSE_URL")));
  });

  it("refuses to start without a projection version, rather than guessing one", () => {
    // Guessing would mean carrying a second copy of the API's constant, which
    // could disagree with it — and a reader on a version nobody maintains
    // fails silently, by serving history that stopped moving.
    const issues = issuesFor(withEnv({ TIMELINE_PROJECTION_VERSION: undefined }));

    assert.ok(issues.some((issue) => issue.startsWith("TIMELINE_PROJECTION_VERSION")));
  });

  it("refuses to start without the database that answers whether a Session is open", () => {
    const issues = issuesFor(withEnv({ POSTGRES_HOST: undefined }));

    assert.ok(issues.some((issue) => issue.startsWith("POSTGRES_HOST")));
  });

  it("refuses to start without a verification secret", () => {
    const issues = issuesFor(withEnv({ AUTH_JWT_SECRET: undefined }));

    assert.ok(issues.some((issue) => issue.startsWith("AUTH_JWT_SECRET")));
  });

  it("refuses a signing secret short enough to be guessed", () => {
    const issues = issuesFor(withEnv({ AUTH_JWT_SECRET: "short" }));

    assert.ok(issues.some((issue) => issue.startsWith("AUTH_JWT_SECRET")));
  });

  it("refuses a port outside the range there are ports in", () => {
    const issues = issuesFor(withEnv({ FEED_AGGREGATOR_PORT: "70000" }));

    assert.ok(issues.some((issue) => issue.startsWith("FEED_AGGREGATOR_PORT")));
  });

  it("reports every problem at once rather than the first", () => {
    const issues = issuesFor(
      withEnv({ CLICKHOUSE_URL: undefined, POSTGRES_HOST: undefined, AUTH_JWT_SECRET: undefined }),
    );

    assert.equal(issues.length, 3);
  });

  it("names the variable without echoing what was in it", () => {
    const issues = issuesFor(withEnv({ AUTH_JWT_SECRET: "too-short" }));

    assert.ok(issues.some((issue) => issue.includes("AUTH_JWT_SECRET")));
    assert.ok(issues.every((issue) => !issue.includes("too-short")));
  });

  it("refuses to start without a Search index version, rather than guessing one", () => {
    // The failure this prevents is quiet: defaulted, the aggregator would ask a
    // version the API may have stopped serving and refuse every arrival, or
    // answer from an index built under rules nobody is applying any more.
    const issues = issuesFor(withEnv({ SEARCH_INDEX_VERSION: undefined }));

    assert.ok(
      issues.some((issue) => issue.includes("SEARCH_INDEX_VERSION")),
      issues.join("; "),
    );
  });
});
