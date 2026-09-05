import type { AppConfig } from "../config/app-config.js";

/**
 * The configuration tests build an application from.
 *
 * Reads the environment field by field with local defaults, rather than going
 * through `loadConfig`, so a suite runs against whatever infrastructure is
 * actually up without requiring a complete environment to be present. The
 * defaults match `docker/compose.yaml`.
 *
 * It cannot borrow `apps/api/src/testing/app-config.ts`: the two applications
 * may not import each other, and this one needs a different shape anyway.
 *
 * @param overrides - Anything a particular suite needs different — most often
 *   nothing, occasionally a depth bound low enough to exceed on purpose.
 * @returns Configuration suitable for building an application in a test.
 */
export function testAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    // Quiet by default. A suite that fails should fail with its assertion in
    // view rather than under a hundred lines of request logging.
    logLevel: "fatal",
    host: "127.0.0.1",
    // Never bound. Tests reach the application through injection.
    port: 0,
    clickhouse: {
      url: process.env["CLICKHOUSE_URL"] ?? "http://localhost:8123",
      database: process.env["CLICKHOUSE_DATABASE"] ?? "chronologity",
      username: process.env["CLICKHOUSE_USERNAME"] ?? "chronologity",
      password: process.env["CLICKHOUSE_PASSWORD"] ?? "chronologity",
      projectionVersion: process.env["TIMELINE_PROJECTION_VERSION"] ?? "timeline-v1",
    },
    database: {
      host: process.env["POSTGRES_HOST"] ?? "localhost",
      port: Number(process.env["POSTGRES_PORT"] ?? "5432"),
      database: process.env["POSTGRES_DATABASE"] ?? "chronologity",
      user: process.env["POSTGRES_USER"] ?? "chronologity",
      password: process.env["POSTGRES_PASSWORD"] ?? "chronologity",
    },
    auth: {
      // The real one where it is set, because the integration suite signs
      // tokens the application then has to accept, and a suite that signed with
      // its own secret would prove only that it agreed with itself.
      jwtSecret: new TextEncoder().encode(
        process.env["AUTH_JWT_SECRET"] ?? "local-development-only-replace-with-a-generated-value",
      ),
      issuer: process.env["AUTH_JWT_ISSUER"] ?? "chronologity",
      audience: process.env["AUTH_JWT_AUDIENCE"] ?? "chronologity-clients",
    },
    search: {
      indexVersion: process.env["SEARCH_INDEX_VERSION"] ?? "search-v1",
    },
    graphql: {
      maxDepth: 12,
      // Off, so a suite never depends on the explorer's static assets being
      // present in whatever tree it runs from.
      graphiql: false,
    },
    ...overrides,
  };
}
