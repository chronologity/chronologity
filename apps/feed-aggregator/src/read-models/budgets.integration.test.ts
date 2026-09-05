import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { toRecord } from "@chronologity/timeline-derivation";
import { describe, it } from "vitest";
import { testAppConfig } from "../testing/app-config.js";
import { createReadStore } from "./clickhouse/client.js";
import { TimelineReadModel } from "./clickhouse/timeline-read-model.js";
import { createDirectory } from "./postgres/client.js";

/**
 * The ceiling on every store read.
 *
 * `scalability.md:1434` defines a query budget as four dials — rows scanned,
 * duration, memory, page size — and the fourth is bounded by the contract's page
 * schemas. These are the other three, plus the PostgreSQL statement timeout that
 * `data-storage.md:1389` requires and that existed nowhere in this repository.
 *
 * **Asserted against the server rather than against the configuration object.**
 * A test reading back the settings it just passed in proves the object literal
 * is spelled the way the test spells it. What matters is whether ClickHouse and
 * PostgreSQL actually applied them, which only they can say — and both will
 * silently ignore a setting whose name is wrong.
 */

const config = testAppConfig();

describe("what a store read may cost", () => {
  it("gives ClickHouse a duration, a row ceiling and a memory ceiling", async () => {
    const store = createReadStore(config.clickhouse);

    try {
      const result = await store.client.query({
        query: `SELECT name, value FROM system.settings
                 WHERE name IN ('max_execution_time', 'max_rows_to_read', 'max_memory_usage')
                 ORDER BY name`,
        format: "JSONEachRow",
      });
      const settings = Object.fromEntries(
        (await result.json<{ name: string; value: string }>()).map((row) => [row.name, row.value]),
      );

      assert.equal(settings["max_execution_time"], "10");
      assert.equal(settings["max_rows_to_read"], "50000000");
      assert.equal(settings["max_memory_usage"], "2000000000");
    } finally {
      await store.close();
    }
  });

  it("stops a ClickHouse query that would read past its row ceiling", async () => {
    // The ceiling doing its job rather than merely being set, which is the
    // behaviour `scalability.md:886` asks for: "reject overly expensive queries
    // rather than allowing uncontrolled ClickHouse scans."
    //
    // Rows rather than duration, because rows are deterministic: the server
    // knows before it starts that this reads more than it is allowed to, and
    // refuses immediately. A duration test would have to actually wait, and
    // `sleep()` does not trip the execution check anyway — it was tried.
    const store = createReadStore(config.clickhouse);

    try {
      await assert.rejects(
        store.client.query({ query: "SELECT count() FROM numbers(60000000)" }),
        /TOO_MANY_ROWS|limit.*rows|exceed/i,
      );
    } finally {
      await store.close();
    }
  });

  it("gives every pooled PostgreSQL connection a statement timeout", async () => {
    // Per connection, because that is where `pg` applies it. A pool that set it
    // on the first connection only would bound the first query of a process and
    // nothing after it.
    const directory = createDirectory(config.database);

    try {
      const first = await directory.pool.query<{ statement_timeout: string }>("SHOW statement_timeout");
      const second = await directory.pool.query<{ statement_timeout: string }>("SHOW statement_timeout");

      assert.equal(first.rows[0]?.statement_timeout, "10s");
      assert.equal(second.rows[0]?.statement_timeout, "10s");
    } finally {
      await directory.close();
    }
  });

  it("stops a PostgreSQL statement that would run past its timeout", async () => {
    const directory = createDirectory(config.database);

    try {
      await assert.rejects(
        directory.pool.query("SELECT pg_sleep(15)"),
        /statement timeout|canceling statement/i,
      );
    } finally {
      await directory.close();
    }
  });
});

describe("telling a stale projection from an empty one", () => {
  it("reports no lag at all for a version holding nothing", async () => {
    // Undefined rather than zero, and the distinction is the whole point: zero
    // reads as perfectly fresh on every dashboard, which is the opposite of what
    // an empty projection means.
    const store = createReadStore({ ...config.clickhouse, projectionVersion: `empty-${Date.now()}` });
    const timeline = new TimelineReadModel(store.client, store.projectionVersion);

    try {
      assert.equal(await timeline.projectionLag(), undefined);
    } finally {
      await store.close();
    }
  });

  it("reports how far behind a version that holds something is", async () => {
    const version = `lag-${randomUUID().slice(0, 8)}`;
    const store = createReadStore({ ...config.clickhouse, projectionVersion: version });
    const timeline = new TimelineReadModel(store.client, version);

    try {
      await store.client.insert({
        table: "timeline_moments",
        values: [
          toRecord(
            {
              momentId: randomUUID(),
              authorUserId: randomUUID(),
              occurredAt: new Date("1998-07-04T19:30:00.000Z"),
              recordedAt: new Date(),
              occurrenceEnd: new Date("1998-07-04T19:30:00.000Z"),
              occurrencePrecision: "instant",
              occurrenceOffsetMinutes: 0,
              visibility: "public",
              moderationState: "allowed",
              discoverable: true,
            },
            new Date(Date.now() - 3_600_000),
            version,
          ),
        ],
        format: "JSONEachRow",
      });

      const lag = await timeline.projectionLag();

      assert.ok(lag !== undefined, "a projection holding a row reported no lag");
      // An hour, give or take the time this test took to run. Asserted as a
      // range rather than a value, because the alternative is asserting a clock.
      assert.ok(lag > 3_500 && lag < 3_700, `lag was ${lag}`);
    } finally {
      await store.client.command({
        query: `DELETE FROM timeline_moments WHERE projection_version = '${version}'`,
      });
      await store.close();
    }
  });
});
