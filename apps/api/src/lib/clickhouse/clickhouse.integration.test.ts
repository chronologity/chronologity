import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createAnalytics, type Analytics } from "./clickhouse.js";
import { migrateAnalytics } from "./migrations.js";
import { testAppConfig } from "../../testing/app-config.js";

/**
 * The ClickHouse boundary and its migration runner, against a real server.
 *
 * Everything worth asserting here is a property of ClickHouse rather than of
 * this code: whether a health check notices an unreachable server, whether the
 * runner applies a file once, whether `final = 1` reaches a query as a session
 * setting. A fake would answer all three the way its author expected, which is
 * exactly what wants checking — and the deduplication setting in particular has
 * already been wrong once, silently, in a way only the real engine revealed.
 *
 * Requires `pnpm infra:up`.
 */

const config = testAppConfig("clickhouse-integration");

describe("the ClickHouse boundary", () => {
  let analytics: Analytics;

  beforeAll(() => {
    analytics = createAnalytics(config.clickhouse);
  });

  afterAll(async () => {
    await analytics.close();
  });

  it("performs a real query when asked whether it is healthy", async () => {
    await analytics.checkHealth();
  });

  it("reports itself by name, so readiness can say which dependency failed", () => {
    assert.equal(analytics.name, "clickhouse");
  });

  it("fails a health check against a server that is not there", async () => {
    // The whole point of a health check. One that passed because a client
    // object existed would tell an orchestrator nothing, which is what
    // `HealthCheckable` says in as many words.
    const absent = createAnalytics({ ...config.clickhouse, url: "http://127.0.0.1:59999" });

    await assert.rejects(() => absent.checkHealth());
    await absent.close();
  });

  it("fails a health check when the credentials are wrong", async () => {
    // Distinct from unreachable, and worth separating: a server that answers
    // and refuses is a configuration error rather than an outage, and both
    // must stop a process rather than one being mistaken for the other.
    const refused = createAnalytics({ ...config.clickhouse, password: "not-the-password" });

    await assert.rejects(() => refused.checkHealth());
    await refused.close();
  });

  it("closes without complaint, twice", async () => {
    // Shutdown paths run when something has already gone wrong, and a close
    // that throws the second time turns one failure into two.
    const client = createAnalytics(config.clickhouse);

    await client.close();
    await client.close();
  });

  it("collapses duplicate rows on read, without any query saying so", async () => {
    // The setting this boundary exists to apply. `ReplacingMergeTree` merges
    // parts at a time nobody controls, so a read taken in between sees both
    // rows — and every call site remembering `FINAL` is not a control.
    const table = `probe_${randomUUID().replaceAll("-", "")}`;

    await analytics.client.command({
      query: `CREATE TABLE ${table} (id String, version UInt64)
              ENGINE = ReplacingMergeTree(version) ORDER BY id`,
    });

    try {
      for (const version of [1, 2]) {
        await analytics.client.insert({
          table,
          values: [{ id: "one", version }],
          format: "JSONEachRow",
        });
      }

      const result = await analytics.client.query({
        query: `SELECT version FROM ${table}`,
        format: "JSONEachRow",
      });
      const rows = await result.json<{ version: number }>();

      assert.equal(rows.length, 1, "a caller saw the same row twice");
      assert.equal(Number(rows[0]?.version), 2, "the superseded row won");
    } finally {
      await analytics.client.command({ query: `DROP TABLE ${table}` });
    }
  });
});

describe("applying ClickHouse migrations", () => {
  let analytics: Analytics;

  beforeAll(() => {
    analytics = createAnalytics(config.clickhouse);
  });

  afterAll(async () => {
    await analytics.close();
  });

  it("creates the schema the projection needs", async () => {
    await migrateAnalytics(analytics.client);

    const result = await analytics.client.query({
      query: `SELECT name FROM system.tables
               WHERE database = {database: String} AND name = 'timeline_moments'`,
      query_params: { database: config.clickhouse.database },
      format: "JSONEachRow",
    });

    assert.equal((await result.json()).length, 1, "timeline_moments was not created");
  });

  it("applies nothing the second time", async () => {
    await migrateAnalytics(analytics.client);

    const again = await migrateAnalytics(analytics.client);

    assert.deepEqual(again.applied, []);
    assert.ok(again.alreadyApplied > 0);
  });

  it("records every migration exactly once, however often it runs", async () => {
    // The record is a `ReplacingMergeTree` keyed on the version, so a second
    // run that re-recorded an applied migration would leave two rows and the
    // count would drift. Read through the boundary, which collapses them.
    await migrateAnalytics(analytics.client);
    await migrateAnalytics(analytics.client);

    const result = await analytics.client.query({
      query: `SELECT version, count() AS count FROM schema_migrations GROUP BY version`,
      format: "JSONEachRow",
    });

    for (const row of await result.json<{ version: string; count: number }>()) {
      assert.equal(Number(row.count), 1, `${row.version} is recorded more than once`);
    }
  });

  it("orders the schema by occurrence and identifier, as the Timeline requires", async () => {
    // `timeline.md:252` requires this tuple in the sort key, in cursor encoding
    // and in jump anchoring. It is asserted here rather than left to a comment
    // because 7B has to agree with it, and a sort key changed by accident would
    // be discovered as pagination that skips rows.
    await migrateAnalytics(analytics.client);

    const result = await analytics.client.query({
      query: `SELECT sorting_key FROM system.tables
               WHERE database = {database: String} AND name = 'timeline_moments'`,
      query_params: { database: config.clickhouse.database },
      format: "JSONEachRow",
    });
    const [table] = await result.json<{ sorting_key: string }>();

    assert.match(table?.sorting_key ?? "", /^occurred_at, moment_id/);
  });

  it("stores the identifier as text, so one ordering holds everywhere", async () => {
    // Measured before it was decided: ClickHouse orders its own `UUID` type by
    // a binary form that disagrees with every string sort, and a cursor is
    // built outside ClickHouse. Storing the text is what keeps the two in
    // agreement, and this is what stops somebody "tidying" the column later.
    await migrateAnalytics(analytics.client);

    const result = await analytics.client.query({
      query: `SELECT name, type FROM system.columns
               WHERE database = {database: String} AND table = 'timeline_moments'
                 AND name IN ('moment_id', 'author_user_id')`,
      query_params: { database: config.clickhouse.database },
      format: "JSONEachRow",
    });

    for (const column of await result.json<{ name: string; type: string }>()) {
      assert.equal(column.type, "String", `${column.name} is not stored as text`);
    }
  });
});
