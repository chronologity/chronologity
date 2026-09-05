#!/usr/bin/env node
//
// What this service costs when several people read at once.
//
//     pnpm --filter @chronologity/feed-aggregator build
//     SCALE_VERSION=bench pnpm --filter @chronologity/feed-aggregator load --save
//
// **This is not `scripts/measure-reads.mjs`.** That runs one request at a time
// and asks which read is expensive. This runs many and asks what happens when
// they contend — for the pool's ten connections, for ClickHouse's threads, for
// the event loop. A service can have flat per-read costs and fall over at four
// concurrent readers, and only one of these two scripts can tell you.
//
// **It is not `scripts/load.mjs` either.** That measures the API over a real
// socket with autocannon. This binds a real port too, because the thing being
// measured is contention and `app.inject()` has no socket to contend for.
//
// **A mix, not a hammer.** `scalability.md:982`: "Avoid synthetic tests that
// only hammer one endpoint uniformly." The mix below is the aggregator's slice
// of `scalability.md:986-993` — Timeline scroll, Moment depth, temporal zoom,
// historical jump — weighted the way a client actually reads: mostly scrolling,
// occasionally opening something.
//
// **Nothing here runs in CI and nothing asserts a duration.** `load.mjs` argues
// it and ADR-147 repeats it: a shared runner's throughput varies by more than
// any regression worth catching, so a threshold built on it fails for reasons
// nobody can act on and gets deleted within a fortnight.
//
// Usage: load                    measure and print
//        load --save             measure and write the baseline
//        load --compare <file>   print deltas against an earlier baseline

import autocannon from "autocannon";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASELINE = `${ROOT}docs/architecture/aggregator-load-baseline.json`;
const envFile = `${ROOT}.env`;

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const { values } = parseArgs({
  options: {
    save: { type: "boolean", default: false },
    compare: { type: "string" },
    seed: { type: "string" },
  },
});

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "postgres", "clickhouse"]);
const hostOf = (url) =>
  String(url ?? "")
    .replace(/^\w+:\/\//, "")
    .replace(/[:/].*$/, "");

// The same guard the sibling scripts carry, and for the same reason: this puts
// a service under sustained load, and the only thing it may ever be pointed at
// is this machine.
for (const [what, host] of [
  ["ClickHouse", hostOf(process.env.CLICKHOUSE_URL ?? "http://localhost:8123")],
  ["PostgreSQL", process.env.POSTGRES_HOST ?? "localhost"],
]) {
  if (!LOCAL.has(host)) {
    console.error(`Refusing to load ${what} at '${host}'. Local development only.`);
    process.exit(1);
  }
}

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run a load test with NODE_ENV=production.");
  process.exit(1);
}

const { loadConfig } = await import(`${ROOT}apps/feed-aggregator/dist/config/app-config.js`);
const { composeApp } = await import(`${ROOT}apps/feed-aggregator/dist/server/compose.js`);

const PORT = Number(process.env.LOAD_PORT ?? 4100);

const config = {
  ...loadConfig(),
  port: PORT,
  host: "127.0.0.1",
  logLevel: "fatal",
  graphql: {
    ...loadConfig().graphql,
    // **Raised far above what a deployment serves**, for the reason `load.mjs`
    // records after the API's limiter went unnoticed: "the first run of this
    // harness recorded 2,618 requests a second and every one of them was
    // rejected." A refused document is fast and measures nothing.
    //
    // 9I deliberately shipped no limiter so its own harness had something to
    // configure. This is the harness that needed it.
    maxCost: 1_000_000,
  },
  ...(process.env.SCALE_VERSION === undefined
    ? {}
    : { clickhouse: { ...loadConfig().clickhouse, projectionVersion: process.env.SCALE_VERSION } }),
};

const { app, dependencies, directory } = await composeApp(config);

/**
 * Somebody to read as, and a credential for them.
 *
 * @returns The reader's identifier and a bearer token.
 */
async function reader() {
  const identityId = randomUUID();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const handle = `load-${randomUUID().slice(0, 8)}`;

  await directory.pool.query(
    "INSERT INTO identities (identity_id, created_at) VALUES ($1, now())",
    [identityId],
  );
  await directory.pool.query(
    `INSERT INTO users (user_id, identity_id, handle, display_name, status, created_at)
     VALUES ($1, $2, $3, $3, 'active', now())`,
    [userId, identityId, handle],
  );
  await directory.pool.query(
    `INSERT INTO sessions (session_id, identity_id, created_at, expires_at, revoked_at)
     VALUES ($1, $2, now(), now() + interval '1 hour', NULL)`,
    [sessionId, identityId],
  );

  const token = await new SignJWT({ sid: sessionId, uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(identityId)
    .setIssuer(config.auth.issuer)
    .setAudience(config.auth.audience)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(config.auth.jwtSecret);

  return { identityId, userId, sessionId, token };
}

/**
 * Somebody with history, so a scroll returns something.
 *
 * @returns A person whose Timeline the projection holds, or the reader when the
 *   projection is empty — in which case the run refuses to save.
 */
async function subject() {
  const store = dependencies.find((one) => one.name === "clickhouse");
  const result = await store.client.query({
    query: `SELECT author_user_id AS id, count() AS held
              FROM timeline_moment_contexts
             WHERE projection_version = {version: String} AND context_type = 'person'
             GROUP BY author_user_id
             ORDER BY held DESC
             LIMIT 1`,
    query_params: { version: config.clickhouse.projectionVersion },
    format: "JSONEachRow",
  });
  const rows = await result.json();

  return rows[0]?.id;
}

const who = await reader();
const person = await subject();

if (person === undefined) {
  console.error(
    `Nothing is projected under version '${config.clickhouse.projectionVersion}'.\n` +
      "Seed and rebuild first — see scripts/measure-reads.mjs for the sequence.",
  );
  process.exit(1);
}

const view = { scope: { type: "PERSON", id: person } };

/**
 * The mix, weighted the way somebody reads rather than uniformly.
 *
 * Scrolling dominates because scrolling is what people do; depth, zoom and
 * jumps are what they do occasionally. A uniform mix would report a number no
 * real traffic produces.
 */
const MIX = [
  {
    weight: 6,
    name: "scroll a Timeline",
    query: "query S($view: TimelineViewInput!) { timeline(view: $view, first: 50) { edges { cursor } } }",
    variables: { view },
  },
  {
    weight: 2,
    name: "zoom out to years",
    query:
      "query Z($view: TimelineViewInput!) { temporalDistribution(view: $view, scale: YEAR) { buckets { startsAt count } } }",
    variables: {
      view: {
        ...view,
        range: { fixed: { from: "1960-01-01T00:00:00Z", to: "2000-01-01T00:00:00Z" } },
      },
    },
  },
  {
    weight: 1,
    name: "jump to an instant",
    query:
      "query J($view: TimelineViewInput!, $anchor: TimelineAnchorInput!) { timelineAround(view: $view, anchor: $anchor, first: 20) { anchoredAt } }",
    variables: { view, anchor: { instant: "1994-06-15T00:00:00Z" } },
  },
  {
    weight: 1,
    name: "open the head of a Timeline",
    query:
      "query H($view: TimelineViewInput!) { timelineHead(view: $view) { ... on ReadableTimelineEntry { momentId } } }",
    variables: { view },
  },
];

const requests = MIX.flatMap((one) =>
  Array.from({ length: one.weight }, () => ({
    method: "POST",
    path: "/graphql",
    headers: { "content-type": "application/json", authorization: `Bearer ${who.token}` },
    body: JSON.stringify({ query: one.query, variables: one.variables }),
  })),
);

/**
 * Run one measurement.
 *
 * @param connections - How many readers at once.
 * @param duration - How long, in seconds.
 * @returns The result autocannon reported.
 * @throws {Error} If any request failed or was refused, because the numbers
 *   would then measure refusing rather than serving — the mistake `load.mjs`
 *   records catching only after the fact.
 */
async function measure(connections, duration) {
  const result = await autocannon({
    url: `http://127.0.0.1:${PORT}`,
    connections,
    duration,
    requests,
    // Nothing here is idempotent-unsafe, but a pipeline would measure the
    // client's ability to keep a socket busy rather than the service's ability
    // to answer.
    pipelining: 1,
    // Far above autocannon's ten-second default, and the default is why: at
    // sixteen readers this mix exceeded it, and a timed-out request is excluded
    // from the latency figures rather than counted in them. The result was a
    // run that looked fast because its slowest requests had been dropped. A
    // generous ceiling means a slow answer is recorded as slow.
    timeout: 60,
  });

  if (result.non2xx > 0 || result.errors > 0) {
    throw new Error(
      `${result.non2xx} non-2xx, ${result.errors} errors, ${result.timeouts} timeouts, ` +
        `${result.mismatches ?? 0} mismatches. The numbers would measure failure, not service.`,
    );
  }

  return result;
}

/**
 * Whether a response body carried GraphQL errors.
 *
 * **The check autocannon cannot make.** An unauthenticated or refused GraphQL
 * request answers 200 with errors in the body, so `non2xx` stays zero while
 * every request measures the cost of refusing — the trap ADR-147 names.
 *
 * @returns The first error message found, or undefined when the mix answers.
 */
async function brokenScenario() {
  for (const one of MIX) {
    const response = await app.inject({
      method: "POST",
      url: "/graphql",
      headers: { authorization: `Bearer ${who.token}` },
      payload: { query: one.query, variables: one.variables },
    });
    const body = response.json();

    if (body.errors !== undefined) {
      return `${one.name}: ${JSON.stringify(body.errors)}`;
    }
  }

  return undefined;
}

await app.listen({ port: PORT, host: "127.0.0.1" });

const measurements = [];

try {
  const broken = await brokenScenario();

  if (broken !== undefined) {
    console.error(`\nRefusing to measure: ${broken}`);
    process.exit(1);
  }

  // **The shape across concurrency is the measurement, not any single number.**
  // Where throughput stops rising and latency starts climbing is where
  // contention begins, and that is the only thing a run on one laptop can say
  // that is worth saying.
  //
  // Configurable because the useful range depends on the machine: on the one
  // this was written for, sixteen concurrent readers exceeded ClickHouse's own
  // ten-second budget and the service correctly refused — which is a finding
  // about a four-core laptop running three databases beside the service, not
  // about the code.
  const levels = (process.env.LOAD_CONNECTIONS ?? "1,2,4,8").split(",").map(Number);

  for (const connections of levels) {
    // Discarded: a cold process, an empty pool and unwarmed query plans.
    await measure(connections, 3);

    const result = await measure(connections, 10);

    measurements.push({
      connections,
      requestsPerSecond: Number(result.requests.average.toFixed(1)),
      latencyMs: {
        p50: result.latency.p50,
        p97_5: result.latency.p97_5,
        max: result.latency.max,
      },
      requests: result.requests.total,
    });

    process.stdout.write(
      `${String(connections).padStart(3)} readers  ` +
        `${String(Number(result.requests.average.toFixed(1))).padStart(8)} req/s  ` +
        `p50 ${String(result.latency.p50).padStart(5)} ms  ` +
        `p97.5 ${String(result.latency.p97_5).padStart(6)} ms\n`,
    );
  }
} finally {
  await app.close();

  for (const dependency of [...dependencies].reverse()) {
    // Tolerated, because a store whose sockets a load run exhausted will refuse
    // to be closed politely — and a measurement that succeeded must not be
    // reported as a failure by its own tidying up.
    try {
      await dependency.close();
    } catch (error) {
      process.stderr.write(`Could not close ${dependency.name}: ${String(error)}\n`);
    }
  }
}

const report = {
  recordedAt: new Date().toISOString(),
  commit: execSync("git rev-parse --short HEAD").toString().trim(),
  dirty: execSync("git status --porcelain -- apps packages").toString().trim().length > 0,
  machine: {
    platform: process.platform,
    arch: process.arch,
    cpus: cpus().length,
    memoryGb: Math.round(totalmem() / 1024 ** 3),
    node: process.version,
  },
  caveat:
    "A mix of Timeline scroll, temporal zoom, historical jump and head reads, over a real socket on one developer machine. What is worth reading is the shape across concurrency, not any single number: throughput that stops rising and latency that starts climbing is where contention begins. Comparable to another run on the same machine; not to anything else.",
  projectionVersion: config.clickhouse.projectionVersion,
  seed: values.seed ?? null,
  mix: MIX.map((one) => ({ name: one.name, weight: one.weight })),
  measurements,
};

if (values.compare !== undefined) {
  const earlier = JSON.parse(readFileSync(values.compare, "utf8"));

  process.stdout.write(`\nagainst ${values.compare}:\n`);

  for (const now of measurements) {
    const before = earlier.measurements.find((one) => one.connections === now.connections);

    if (before !== undefined) {
      const delta = now.requestsPerSecond - before.requestsPerSecond;

      process.stdout.write(
        `  ${String(now.connections).padStart(3)} readers  ` +
          `${before.requestsPerSecond} -> ${now.requestsPerSecond} req/s ` +
          `(${delta >= 0 ? "+" : ""}${delta.toFixed(1)})\n`,
      );
    }
  }
}

if (values.save) {
  if (values.seed === undefined) {
    console.error(
      "\nRefusing to save without --seed. A baseline whose corpus cannot be rebuilt\n" +
        "is a number nobody can reproduce or compare against.",
    );
    process.exit(1);
  }

  writeFileSync(BASELINE, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`\nWrote ${BASELINE}\n`);
}
