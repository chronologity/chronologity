import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { testAppConfig } from "../testing/app-config.js";
import { createReadStore } from "./clickhouse/client.js";
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

