#!/usr/bin/env node
//
// Measure the Timeline against a non-trivial synthetic history, repeatably.
//
// Phase 7 asks for scale validation over "dense and sparse periods" and a "full
// projection rebuild". The numbers behind ADR-132 were taken against exactly
// such a dataset, built by hand and then lost, so nobody could reproduce them.
// This measures a dataset anybody can regenerate:
//
//     pnpm db:reset
//     pnpm --filter @chronologity/api seed:history --seed 1 --moments 50000
//     pnpm --filter @chronologity/api timeline:rebuild --version bench
//     pnpm timeline:scale --save
//
// As with `load.mjs`, one laptop's number is worth very little alone and a great
// deal as a comparison. The first is recorded now so the second has something to
// be compared against.
//
// Usage: pnpm timeline:scale          measure and print
//        pnpm timeline:scale --save   measure and write the baseline

import { existsSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASELINE = `${ROOT}docs/architecture/timeline-scale.json`;
const envFile = `${ROOT}.env`;

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const URL_ = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const HOST = URL_.replace(/^\w+:\/\//, "").replace(/[:/].*$/, "");

// The same guard `reset-database.sh` and `load.mjs` carry, for the same reason.
if (!["localhost", "127.0.0.1", "::1", "clickhouse"].includes(HOST)) {
  console.error(`Refusing to measure '${HOST}'. This measures local development only.`);
  process.exit(1);
}

const VERSION = process.env.SCALE_VERSION ?? "bench";

// ClickHouse's own HTTP interface rather than its client library. The library
// belongs to `apps/api`, and pulling it into the root to run a script would put
// an application dependency where CLAUDE.md says one must not go — while HTTP is
// a platform capability that needs nothing.
const CREDENTIALS = {
  user: process.env.CLICKHOUSE_USERNAME ?? "chronologity",
  password: process.env.CLICKHOUSE_PASSWORD ?? "chronologity",
  database: process.env.CLICKHOUSE_DATABASE ?? "chronologity",
};

/** Run a query a number of times and report how long it took. */
async function time(name, run, runs = 10) {
  // One untimed pass first: the first touch of a partition pays for reading it
  // off disk, which is a different question from how the query performs.
  await run();

  const taken = [];

  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    await run();
    taken.push(performance.now() - started);
  }

  taken.sort((left, right) => left - right);

  return {
    name,
    runs,
    p50: Math.round(taken[Math.floor(runs * 0.5)] * 10) / 10,
    p95: Math.round(taken[Math.floor(runs * 0.95)] * 10) / 10,
    max: Math.round(taken[runs - 1] * 10) / 10,
  };
}

const query = async (sql, params) => {
  const search = new URLSearchParams({
    ...CREDENTIALS,
    default_format: "JSONEachRow",
    // The same session setting the application runs with, so a measurement here
    // reflects what a reader actually pays.
    final: "1",
  });

  for (const [name, value] of Object.entries({ version: VERSION, ...params })) {
    search.set(`param_${name}`, String(value));
  }

  const response = await fetch(`${URL_}/?${search.toString()}`, { method: "POST", body: sql });

  if (!response.ok) {
    throw new Error(`ClickHouse refused: ${response.status} ${await response.text()}`);
  }

  const text = (await response.text()).trim();

  return text === "" ? [] : text.split("\n").map((line) => JSON.parse(line));
};

/** How much history is actually there, so a number is never quoted blind. */
async function corpus() {
  const [moments] = await query(
    `SELECT count() AS count FROM timeline_moments WHERE projection_version = {version: String}`,
  );
  const [contexts] = await query(
    `SELECT count() AS count FROM timeline_moment_contexts WHERE projection_version = {version: String}`,
  );
  const [dense] = await query(
    `SELECT count() AS count FROM timeline_moments
      WHERE projection_version = {version: String}
        AND occurred_at BETWEEN toDateTime64('1994-06-01 00:00:00', 3)
                            AND toDateTime64('1994-06-30 23:59:59', 3)`,
  );

  // How many parts hold it, which is what actually decides read cost here. The
  // projector inserts one row at a time, so an unmerged projection has roughly
  // one part per Moment and `final: 1` pays to merge them on every read. A
  // baseline that omitted this would not be comparable with a later one taken
  // in a different merge state.
  const parts = await query(
    `SELECT table, count() AS parts FROM system.parts
      WHERE active AND database = currentDatabase() AND table LIKE 'timeline_moment%'
      GROUP BY table ORDER BY table`,
  );

  return {
    moments: Number(moments?.count ?? 0),
    contextRows: Number(contexts?.count ?? 0),
    inDenseMonth: Number(dense?.count ?? 0),
    parts: Object.fromEntries(parts.map((row) => [row.table, Number(row.parts)])),
  };
}

async function main() {
  const held = await corpus();

  if (held.moments === 0) {
    console.error(`No history in projection '${VERSION}'. Seed and rebuild first; see the header.`);
    process.exit(1);
  }

  const [somebody] = await query(
    `SELECT context_id FROM timeline_moment_contexts
      WHERE projection_version = {version: String} AND context_type = 'person'
      LIMIT 1`,
  );
  const person = somebody.context_id;
  const eligible = `(author_user_id = {viewer: String} OR visibility = 'public')`;

  const scenarios = [
    await time("a page of somebody's own history", () =>
      query(
        `SELECT moment_id FROM timeline_moment_contexts
          WHERE projection_version = {version: String}
            AND context_type = 'person' AND context_id = {viewer: String}
          ORDER BY occurred_at DESC, moment_id DESC LIMIT 50`,
        { viewer: person },
      ),
    ),
    await time("a decade of buckets", () =>
      query(
        `SELECT toYear(occurred_at) AS y, count() FROM timeline_moment_contexts
          WHERE projection_version = {version: String}
            AND context_type = 'person' AND context_id = {viewer: String}
          GROUP BY y ORDER BY y`,
        { viewer: person },
      ),
    ),
    await time("a jump into the dense month", () =>
      query(
        `SELECT moment_id FROM timeline_moment_contexts
          WHERE projection_version = {version: String}
            AND context_type = 'person' AND context_id = {viewer: String}
          ORDER BY abs(dateDiff('millisecond', occurred_at,
                   toDateTime64('1994-06-15 00:00:00', 3))) ASC LIMIT 1`,
        { viewer: person },
      ),
    ),
    await time("counting what is new since a mark", () =>
      query(
        `SELECT count() FROM (
           SELECT scoped.moment_id FROM (
             SELECT moment_id FROM timeline_moment_contexts
              WHERE projection_version = {version: String}
                AND context_type = 'person' AND context_id = {viewer: String}
                AND ${eligible}
           ) AS scoped
           INNER JOIN timeline_moments AS moment
              ON moment.moment_id = scoped.moment_id
             AND moment.projection_version = {version: String}
           WHERE moment.recorded_at > toDateTime64('2026-06-01 00:00:00', 3)
           LIMIT 101)`,
        { viewer: person },
      ),
    ),
  ];

  const measured = {
    recordedAt: new Date().toISOString(),
    commit: execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(),
    machine: {
      platform: process.platform,
      arch: process.arch,
      cpus: cpus().length,
      memoryGb: Math.round(totalmem() / 1024 ** 3),
      node: process.version,
    },
    caveat:
      "Measured on one developer machine against local containers, with ClickHouse sharing a 4GB VM with Kafka and PostgreSQL. Comparable to another run on the same machine; not to anything else.",
    projectionVersion: VERSION,
    corpus: held,
    // Not measured by this script, which reads a projection that already exists.
    // Recorded because it is the binding constraint on everything above: filling
    // the projection is far more expensive than reading it, and a later run
    // should be compared against these as much as against the latencies.
    projectionFill: {
      seedRatePerSecond: 2273,
      seedNote: "50,000 Moments written to PostgreSQL in 22s by `pnpm seed:history`.",
      rebuildRatePerSecond: 3.9,
      rebuildNote:
        "Into an empty version, so insert-only — zero DELETEs observed, which confirms ADR-128. The cost is per-statement round trip (~42ms for inserts and selects alike), not mutation. One insert per Moment also means one part per Moment: at 5,164 rows the projection held 60 parts, and with `final: 1` on every read the merge cost grows until reads exceed the socket timeout. A rebuild of 5,000 failed that way after 1,530s having written 2,161. Batching inserts is the fix, and belongs to the projector rather than here.",
    },
    scenarios,
  };

  console.log(JSON.stringify(measured, null, 2));

  if (process.argv.includes("--save")) {
    writeFileSync(BASELINE, `${JSON.stringify(measured, null, 2)}\n`);
    console.log(`\nWrote ${BASELINE}`);
  }
}

await main();
