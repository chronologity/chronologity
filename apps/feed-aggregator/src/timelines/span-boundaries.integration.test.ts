import assert from "node:assert/strict";
import type { TimelineScale } from "@chronologity/contracts";
import { clickHouseSpanStart, postgresSpanStart } from "@chronologity/timeline-derivation";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createReadStore, type ReadStore } from "../read-models/clickhouse/client.js";
import { createDirectory, type Directory } from "../read-models/postgres/client.js";
import { testAppConfig } from "../testing/app-config.js";

/**
 * Whether the two stores agree about where a span begins.
 *
 * **The correctness risk of temporal zoom, isolated.** ClickHouse counts how
 * much each span holds and PostgreSQL chooses what stands for it, and the two
 * answers are joined on the span each row falls in. Neither statement can be
 * wrong on its own in a way anybody would notice — a count is a dot's size and a
 * representative is a thumbnail — but if the two disagree by one boundary, a
 * Moment appears under the wrong week and nothing anywhere reports it.
 *
 * The generators are pinned by unit tests, which prove what SQL is emitted and
 * that none of the calendar functions known to fail before 1970 is reached for.
 * Only real engines can prove what that SQL computes, which is why this exists.
 *
 * It touches no fixtures and no application. Each case is a literal instant put
 * through both expressions, so a failure names a boundary rather than a query.
 */

const config = testAppConfig();

let store: ReadStore;
let directory: Directory;

const SCALES: readonly TimelineScale[] = ["day", "week", "month", "year", "decade", "century"];

/**
 * The instants worth asking about, and why each one is here.
 *
 * Named individually rather than generated: each is a specific claim, and a
 * generated corpus would not have found the two that matter.
 */
const INSTANTS: readonly { readonly at: string; readonly why: string }[] = [
  {
    at: "1969-12-25T12:00:00.000Z",
    why: "the truncation trap: a week anchored near the epoch divides a negative number, and integer division truncates towards zero rather than flooring, which would put this Thursday in a week beginning four days later",
  },
  {
    at: "1970-01-01T00:00:00.000Z",
    why: "a span beginning before the epoch while its instant is after it, which no test using positive numbers can reach",
  },
  { at: "1969-12-28T23:59:59.999Z", why: "the last instant of a week" },
  { at: "1969-12-29T00:00:00.000Z", why: "the first instant of the next one" },
  { at: "1900-01-01T00:00:00.000Z", why: "the floor, which is its own week's start" },
  { at: "1901-06-15T00:00:00.000Z", why: "deep pre-epoch, where toStartOfYear is known to answer 1970" },
  { at: "1904-02-29T00:00:00.000Z", why: "a leap day before the epoch" },
  { at: "1969-07-20T20:17:40.000Z", why: "the instant toStartOfInterval placed in 2139" },
  { at: "2000-02-29T00:00:00.000Z", why: "a leap day in the year the century rule makes an exception of" },
  { at: "1999-12-31T23:59:59.999Z", why: "the last instant of a century" },
  { at: "2026-09-04T00:00:00.000Z", why: "an ordinary modern instant, so a total failure reads differently from an edge one" },
];

/**
 * Where ClickHouse says a span begins.
 *
 * @param at - The instant, as ISO.
 * @param scale - How coarsely.
 * @returns The span's start.
 */
async function inClickHouse(at: string, scale: TimelineScale): Promise<Date> {
  const literal = `toDateTime64('${at.replace("T", " ").replace("Z", "")}', 3, 'UTC')`;
  const result = await store.client.query({
    query: `SELECT ${clickHouseSpanStart(scale, literal)} AS starts_at`,
    format: "JSONEachRow",
  });
  const rows = await result.json<{ starts_at: string }>();
  const value = rows[0]?.starts_at;

  assert.ok(value !== undefined, "ClickHouse returned no row");

  // Naive, in UTC because the expression pins it there.
  return new Date(`${value.replace(" ", "T")}Z`);
}

/**
 * Where PostgreSQL says a span begins.
 *
 * @param at - The instant, as ISO.
 * @param scale - How coarsely.
 * @returns The span's start.
 */
async function inPostgres(at: string, scale: TimelineScale): Promise<Date> {
  const result = await directory.pool.query<{ starts_at: Date }>(
    `SELECT ${postgresSpanStart(scale, "$1::timestamptz")} AS starts_at`,
    [at],
  );
  const value = result.rows[0]?.starts_at;

  assert.ok(value !== undefined, "PostgreSQL returned no row");

  return value;
}

beforeAll(() => {
  store = createReadStore(config.clickhouse);
  directory = createDirectory(config.database);
});

afterAll(async () => {
  await store.client.close();
  await directory.pool.end();
});

describe("where a span begins, in both stores at once", () => {
  for (const { at, why } of INSTANTS) {
    for (const scale of SCALES) {
      it(`agrees on the ${scale} holding ${at} — ${why}`, async () => {
        const [clickhouse, postgres] = await Promise.all([
          inClickHouse(at, scale),
          inPostgres(at, scale),
        ]);

        assert.equal(
          clickhouse.getTime(),
          postgres.getTime(),
          `ClickHouse says ${clickhouse.toISOString()}, PostgreSQL says ${postgres.toISOString()}`,
        );
      });
    }
  }
});

describe("the boundaries themselves", () => {
  it("starts every week on a Monday, on both sides of the epoch", async () => {
    for (const { at } of INSTANTS) {
      const start = await inClickHouse(at, "week");

      // 1 is Monday. Asserted rather than assumed, because the ClickHouse
      // expression reaches Monday by arithmetic from 1900 rather than by asking
      // for a weekday at all.
      assert.equal(start.getUTCDay(), 1, `the week holding ${at} starts on ${start.toISOString()}`);
      assert.ok(start.getTime() <= new Date(at).getTime(), `${at} is not inside its own week`);
    }
  });

  it("puts an instant inside the span that claims it, at every scale", async () => {
    for (const { at } of INSTANTS) {
      for (const scale of SCALES) {
        const start = await inPostgres(at, scale);

        assert.ok(
          start.getTime() <= new Date(at).getTime(),
          `the ${scale} holding ${at} begins after it, at ${start.toISOString()}`,
        );
      }
    }
  });

  it("counts a century from the year ending in two zeros, unlike date_trunc", async () => {
    // PostgreSQL's own `date_trunc('century', …)` follows the convention where
    // the twentieth century is 1901–2000 and would answer 1901 here. The two
    // stores would then disagree about which span most of the twentieth century
    // belongs to, which is why the generator refuses that function.
    assert.equal((await inPostgres("1969-06-01T00:00:00.000Z", "century")).toISOString(), "1900-01-01T00:00:00.000Z");
    assert.equal((await inClickHouse("1969-06-01T00:00:00.000Z", "century")).toISOString(), "1900-01-01T00:00:00.000Z");
  });
});

describe("what the projection cannot hold", () => {
  it("silently answers 1900 for an instant older than its calendar", async () => {
    // Recorded rather than asserted as desirable. ClickHouse's DateTime64 floor
    // is 1900-01-01 and an earlier instant saturates to it without erroring — so
    // a Moment recorded for 1850 would be counted in the wrong span rather than
    // refused. That is the reason a distribution may not be asked for below the
    // floor, and this is where the behaviour is written down.
    const result = await store.client.query({
      query: "SELECT toString(toDateTime64('1850-01-01 00:00:00', 3, 'UTC')) AS saturated",
      format: "JSONEachRow",
    });
    const rows = await result.json<{ saturated: string }>();

    assert.equal(rows[0]?.saturated, "1900-01-01 00:00:00.000");
  });

  it("holds 1850 correctly in PostgreSQL, which is why the refusal lives in the request", async () => {
    // The two stores genuinely differ here. PostgreSQL has no epoch
    // discontinuity, so it would bucket 1850 correctly while the projection
    // could not — the disagreement is real and is closed by refusing the range,
    // not by making one store lie.
    assert.equal(
      (await inPostgres("1850-06-15T00:00:00.000Z", "decade")).toISOString(),
      "1850-01-01T00:00:00.000Z",
    );
  });
});
