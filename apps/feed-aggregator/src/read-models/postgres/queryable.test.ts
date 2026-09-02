import assert from "node:assert/strict";
import type pg from "pg";
import { describe, it } from "vitest";
import { asQueryable } from "./queryable.js";

/**
 * The shape difference between `pg` and the shared eligibility rule.
 *
 * Small, and the reason it is tested is that getting it wrong fails quietly in
 * the worst direction: `result` rather than `result.rows` is a truthy object,
 * so a blocked-accounts lookup would return one meaningless entry instead of a
 * list, and a caller reading `.length` would believe the Viewer had blocked
 * somebody. The real statements are exercised against PostgreSQL in
 * `eligibility.integration.test.ts`; what is checked here is the unwrapping.
 */

/** A pool that answers with whatever the test decided, and records the ask. */
const poolReturning = (rows: unknown[]): pg.Pool & { asked: unknown[][] } => {
  const asked: unknown[][] = [];

  return {
    asked,
    query: async (sql: string, parameters?: unknown[]) => {
      asked.push([sql, parameters]);
      return { rows };
    },
  } as unknown as pg.Pool & { asked: unknown[][] };
};

describe("asQueryable", () => {
  it("hands back the rows rather than the result wrapping them", async () => {
    const pool = poolReturning([{ user_id: "a" }, { user_id: "b" }]);

    const rows = await asQueryable(pool).query<{ user_id: string }>("SELECT 1");

    assert.deepEqual(rows, [{ user_id: "a" }, { user_id: "b" }]);
  });

  it("answers an empty result with an empty list", async () => {
    // Not undefined. Every caller maps over what comes back, and the shared
    // resolver's own comment says an absent list would filter everything rather
    // than nothing — an empty Timeline where an error belonged.
    const rows = await asQueryable(poolReturning([])).query("SELECT 1");

    assert.deepEqual(rows, []);
  });

  it("passes the statement and its parameters through untouched", async () => {
    const pool = poolReturning([]);

    await asQueryable(pool).query("SELECT $1::text", ["a-value"]);

    assert.deepEqual(pool.asked, [["SELECT $1::text", ["a-value"]]]);
  });

  it("sends no parameter array when there are none", async () => {
    // `pg` treats an empty array and an absent one differently enough to be
    // worth not guessing at.
    const pool = poolReturning([]);

    await asQueryable(pool).query("SELECT 1");

    assert.deepEqual(pool.asked, [["SELECT 1", undefined]]);
  });

  it("does not hand the caller's array to pg to keep", async () => {
    // The shared interface takes a readonly array. Copying is what lets that
    // promise be kept whatever `pg` does with what it is given.
    const pool = poolReturning([]);
    const parameters = ["a-value"];

    await asQueryable(pool).query("SELECT $1::text", parameters);

    assert.notEqual(pool.asked[0]?.[1], parameters);
    assert.deepEqual(pool.asked[0]?.[1], parameters);
  });
});
