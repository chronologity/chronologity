#!/usr/bin/env node
//
// Measure what this service costs to read from, through the surface it actually
// serves.
//
//     pnpm db:reset
//     pnpm --filter @chronologity/api seed:history --seed 1 --moments 50000 \
//          --places 200 --events 50 --comments 200000 --replies-per 1 \
//          --media-per 5 --participants 5000 --blocks 20
//     pnpm --filter @chronologity/api timeline:rebuild --version bench
//     pnpm --filter @chronologity/feed-aggregator build
//     SCALE_VERSION=bench pnpm --filter @chronologity/feed-aggregator measure --save
//
// **This is not `scripts/timeline-scale.mjs`.** That one talks to ClickHouse over
// raw HTTP with SQL written by hand, so it measures the projection rather than
// this service: no eligibility parameters, no join back for the presented
// columns, no PostgreSQL, no GraphQL. Its numbers are a floor this service is
// built on, not a measurement of it. Nothing had ever measured this service.
//
// **This is not `scripts/load.mjs` either.** That measures throughput under
// concurrency, which is a hardening question. This runs one request at a time
// and asks a narrower thing: which read is expensive, and does its cost grow
// with the corpus.
//
// Every scenario goes through `app.inject()` — the same way every integration
// test drives this service — so the auth hook, the configured query depth,
// eligibility resolution, the request-scoped loaders and both stores are all in
// the measurement. What is left out is a loopback socket, which is the one part
// that is not this application.
//
// **Nothing here asserts a duration.** A threshold built on one laptop fails for
// reasons nobody can act on and gets widened until it means nothing. Durations
// are recorded; what is asserted is that a scenario answered at all.
//
// Usage: measure                 measure and print
//        measure --save          measure and write the baseline
//        measure --compare <file> print deltas against an earlier baseline

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASELINE = `${ROOT}docs/architecture/aggregator-read-baseline.json`;
const envFile = `${ROOT}.env`;

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const { values } = parseArgs({
  options: { save: { type: "boolean", default: false }, compare: { type: "string" } },
});

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "postgres", "clickhouse"]);
const hostOf = (url) => String(url ?? "").replace(/^\w+:\/\//, "").replace(/[:/].*$/, "");

// The same guards the sibling scripts carry, for the same reason: this writes a
// Session row and reads a lot, and neither belongs anywhere but here.
for (const [what, host] of [
  ["ClickHouse", hostOf(process.env.CLICKHOUSE_URL ?? "http://localhost:8123")],
  ["PostgreSQL", process.env.POSTGRES_HOST ?? "localhost"],
]) {
  if (!LOCAL.has(host)) {
    console.error(`Refusing to measure ${what} at '${host}'. Local development only.`);
    process.exit(1);
  }
}

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to measure with NODE_ENV=production.");
  process.exit(1);
}

const { loadConfig } = await import(`${ROOT}apps/feed-aggregator/dist/config/app-config.js`);
const { buildApp } = await import(`${ROOT}apps/feed-aggregator/dist/server/app.js`);
const { createReadStore } = await import(
  `${ROOT}apps/feed-aggregator/dist/read-models/clickhouse/client.js`
);
const { createDirectory } = await import(
  `${ROOT}apps/feed-aggregator/dist/read-models/postgres/client.js`
);
const { asQueryable } = await import(
  `${ROOT}apps/feed-aggregator/dist/read-models/postgres/queryable.js`
);
const { SessionRepository } = await import(
  `${ROOT}apps/feed-aggregator/dist/auth/session.repository.js`
);
const { countingPool, countingStore, newCost } = await import(
  `${ROOT}apps/feed-aggregator/dist/testing/counting.js`
);
const { TimelineEligibilityResolver } = await import("@chronologity/timeline-derivation");

// Which projection to read is the measurement's own choice, so it is supplied
// here rather than required of the environment — a corpus is seeded under a
// named version precisely so a baseline can say which one it measured.
process.env.TIMELINE_PROJECTION_VERSION ??= process.env.SCALE_VERSION ?? "timeline-v1";
// Quiet by default. Fastify logs a line per request at `info`, and this makes
// thousands — which would bury the measurement in its own noise and add the cost
// of writing them to every number. `fatal` is the quietest level the shared
// schema admits. Override with LOG_LEVEL when a scenario misbehaves.
process.env.LOG_LEVEL ??= "fatal";

const base = loadConfig();
const config = {
  ...base,
  clickhouse: {
    ...base.clickhouse,
    projectionVersion: process.env.SCALE_VERSION ?? base.clickhouse.projectionVersion,
  },
};

const cost = newCost();
const store = createReadStore(config.clickhouse);
const directory = createDirectory(config.database);

/**
 * Run a document a number of times and report how long it took.
 *
 * Fifty runs and one untimed warm pass, for the reason `timeline-scale.mjs`
 * records: at ten, the p95 is the worst of ten by construction, and on this
 * machine it moved by a factor of twenty between identical runs.
 *
 * @param name - What is being measured, in words.
 * @param run - Performs one request and returns the parsed body.
 * @returns The timings, what the request cost each store, and whether it
 *   answered.
 */
async function time(name, run) {
  const warm = await run();
  const taken = [];
  const spent = [];
  const statements = { postgres: 0, clickhouse: 0 };

  for (let index = 0; index < 50; index += 1) {
    cost.postgres = 0;
    cost.clickhouse = 0;
    cost.postgresMs = 0;
    cost.clickhouseMs = 0;

    const started = performance.now();
    await run();

    taken.push(performance.now() - started);
    spent.push(cost.postgresMs + cost.clickhouseMs);
    statements.postgres = cost.postgres;
    statements.clickhouse = cost.clickhouse;
  }

  spent.sort((left, right) => left - right);

  taken.sort((left, right) => left - right);

  const round = (value) => Math.round(value * 10) / 10;

  return {
    name,
    runs: 50,
    p50: round(taken[25]),
    p95: round(taken[47]),
    // Alongside rather than instead of: on a contended machine the slowest run
    // says more about what else was running than about the read.
    max: round(taken[49]),
    // What the stores took, against what the whole request took. A read where
    // these are nearly equal is fixed by a better statement; one where they are
    // far apart is fixed here.
    storeMs: round(spent[25]),
    statements,
    // Whether it answered, so nobody quotes a number produced by a refusal. An
    // unauthenticated GraphQL request answers 200 with errors in the body, so a
    // broken token would otherwise produce a fast, clean-looking baseline.
    returned: warm.returned,
    ...(warm.errors === undefined ? {} : { errors: warm.errors }),
  };
}

/**
 * How long a trivial statement takes to reach each store and come back.
 *
 * Recorded because without it every number here reads as an indictment of this
 * service, when on a developer machine most of it is the container network.
 *
 * @returns Milliseconds to each store.
 */
async function roundTrip() {
  const measure = async (run) => {
    const taken = [];

    for (let index = 0; index < 20; index += 1) {
      const started = performance.now();
      await run();
      taken.push(performance.now() - started);
    }

    taken.sort((left, right) => left - right);

    return Math.round(taken[10] * 100) / 100;
  };

  return {
    postgres: await measure(() => directory.pool.query("SELECT 1")),
    clickhouse: await measure(async () =>
      (await store.client.query({ query: "SELECT 1", format: "JSONEachRow" })).json(),
    ),
  };
}

/**
 * What the corpus holds, so two baselines can be told apart.
 *
 * @returns Row counts, and the ClickHouse part counts that decide read cost.
 */
async function corpus() {
  const one = async (sql, params = []) => Number((await directory.pool.query(sql, params)).rows[0].count);
  const rows = async (sql) =>
    (await (await store.client.query({ query: sql, format: "JSONEachRow" })).json());

  const contexts = await rows(
    `SELECT context_type, count() AS count FROM timeline_moment_contexts
      WHERE projection_version = '${config.clickhouse.projectionVersion}'
      GROUP BY context_type ORDER BY context_type`,
  );
  const parts = await rows(
    `SELECT table, count() AS parts FROM system.parts
      WHERE active AND database = currentDatabase() AND table LIKE 'timeline_moment%'
      GROUP BY table ORDER BY table`,
  );

  return {
    moments: await one("SELECT count(*)::int AS count FROM moments WHERE deleted_at IS NULL"),
    comments: await one("SELECT count(*)::int AS count FROM moment_comments"),
    media: await one("SELECT count(*)::int AS count FROM moment_media"),
    places: await one("SELECT count(*)::int AS count FROM locations"),
    events: await one("SELECT count(*)::int AS count FROM real_world_events"),
    participations: await one("SELECT count(*)::int AS count FROM moment_participations"),
    contextRows: Object.fromEntries(contexts.map((row) => [row.context_type, Number(row.count)])),
    // Load-bearing: `final = 1` makes read cost a function of merge state, so
    // two baselines taken in different states are not comparable.
    parts: Object.fromEntries(parts.map((row) => [row.table, Number(row.parts)])),
  };
}

const app = await buildApp({
  config,
  dependencies: [store, directory],
  graphql: {
    store: countingStore(store, cost),
    sessions: new SessionRepository(countingPool(directory.pool, cost)),
    eligibility: new TimelineEligibilityResolver(asQueryable(countingPool(directory.pool, cost))),
    directory: countingPool(directory.pool, cost),
  },
});

/** The account whose history is measured, and a Session to read it through. */
const sessionId = randomUUID();
const measured = (
  await directory.pool.query(
    `SELECT u.user_id, u.identity_id, count(m.moment_id)::int AS moments
       FROM users u JOIN moments m ON m.author_user_id = u.user_id
      WHERE u.handle LIKE 'seed-%'
      GROUP BY u.user_id, u.identity_id
      ORDER BY moments DESC
      LIMIT 1`,
  )
).rows[0];

if (measured === undefined) {
  console.error("No seeded history. See the header for how to make some.");
  process.exit(1);
}

await directory.pool.query(
  `INSERT INTO sessions (session_id, identity_id, created_at, expires_at, revoked_at)
   VALUES ($1, $2, now(), now() + interval '2 hours', NULL)`,
  [sessionId, measured.identity_id],
);

const token = await new SignJWT({ sid: sessionId, uid: measured.user_id })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(measured.identity_id)
  .setIssuer(config.auth.issuer)
  .setAudience(config.auth.audience)
  .setIssuedAt()
  .setExpirationTime("2h")
  .sign(config.auth.jwtSecret);

/**
 * Ask the service one question.
 *
 * @param query - The document.
 * @param variables - Its variables.
 * @returns Whether it answered, and any errors, so a caller can refuse to save.
 */
async function ask(query, variables = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/graphql",
    headers: { authorization: `Bearer ${token}` },
    payload: { query, variables },
  });
  const body = response.json();
  const answered = body.data !== null && body.data !== undefined;

  return {
    body,
    returned: answered && Object.values(body.data).some((value) => value !== null),
    ...(body.errors === undefined ? {} : { errors: body.errors.map((one) => one.message) }),
  };
}

/** What the scenarios need to name: a Moment, a busy discussion, a place, an occasion. */
const subjects = await (async () => {
  const busiest = (
    await directory.pool.query(
      `SELECT c.moment_id, count(*)::int AS comments
         FROM moment_comments c WHERE c.thread_comment_id IS NULL
        GROUP BY c.moment_id ORDER BY comments DESC LIMIT 1`,
    )
  ).rows[0];
  const threads = busiest === undefined
    ? []
    : (
        await directory.pool.query(
          `SELECT comment_id FROM moment_comments
            WHERE moment_id = $1 AND thread_comment_id IS NULL
            ORDER BY created_at LIMIT 100`,
          [busiest.moment_id],
        )
      ).rows.map((row) => row.comment_id);
  const mine = (
    await directory.pool.query(
      `SELECT moment_id FROM moments WHERE author_user_id = $1 AND deleted_at IS NULL LIMIT 10`,
      [measured.user_id],
    )
  ).rows.map((row) => row.moment_id);
  const place = (await directory.pool.query("SELECT location_id FROM locations LIMIT 1")).rows[0];
  const occasion = (
    await directory.pool.query("SELECT real_world_event_id FROM real_world_events LIMIT 1")
  ).rows[0];

  return {
    mine,
    busiest: busiest?.moment_id,
    threads,
    place: place?.location_id,
    occasion: occasion?.real_world_event_id,
  };
})();

const own = { scope: { type: "PERSON", id: measured.user_id } };
const PAGE = `query Page($view: TimelineViewInput!, $first: Int, $after: Cursor) {
  timeline(view: $view, first: $first, after: $after) {
    edges { cursor node { ... on ReadableTimelineEntry { momentId occurredAt } } }
    pageInfo { hasNextPage } } }`;

/**
 * Every scenario, in the order they are reported.
 *
 * Scenario 0 is a control — it reads no history, so a change in it says the
 * machine got busier rather than that this service got slower. The comment-count
 * scenarios are the positive control: they are expected to grow with the corpus,
 * and a harness where nothing grows cannot be shown to detect growth.
 *
 * @returns The measurements.
 */
async function scenarios() {
  const measurements = [];
  const add = async (name, run) => measurements.push(await time(name, run));

  await add("who is asking, and no history at all", () =>
    ask("{ viewer { authenticated userId } }"),
  );

  await add("opening a Timeline at its head", () =>
    ask(
      `query Head($view: TimelineViewInput!) {
         timelineHead(view: $view) { ... on ReadableTimelineEntry { momentId } } }`,
      { view: own },
    ),
  );

  await add("a page of fifty", () => ask(PAGE, { view: own, first: 50 }));
  await add("a page of two hundred", () => ask(PAGE, { view: own, first: 200 }));

  const opening = await ask(PAGE, { view: own, first: 50 });
  const cursor = opening.body.data?.timeline?.edges?.at(-1)?.cursor;

  if (cursor !== undefined) {
    await add("resuming a page from a cursor", () =>
      ask(PAGE, { view: own, first: 50, after: cursor }),
    );
  }

  if (subjects.place !== undefined) {
    await add("a page of a place's history", () =>
      ask(PAGE, { view: { scope: { type: "LOCATION", id: subjects.place } }, first: 50 }),
    );
  }

  if (subjects.mine[0] !== undefined) {
    await add("opening one Moment", () =>
      ask(
        `query One($id: ID!) {
           moment(id: $id) { momentId caption occurrence { start } place { disclosure }
             media(first: 10) { edges { node { mediaId } } }
             reactions { total } relationships { relationshipId } } }`,
        { id: subjects.mine[0] },
      ),
    );
  }

  if (subjects.busiest !== undefined) {
    await add("a page of a hundred comments", () =>
      ask(
        `query Talk($id: ID!) {
           moment(id: $id) { comments(first: 100) { edges { node { commentId body } } } } }`,
        { id: subjects.busiest },
      ),
    );

    if (subjects.threads.length > 0) {
      const replies = subjects.threads
        .map((thread, index) => `r${index}: comments(first: 5, thread: "${thread}") { edges { node { commentId } } }`)
        .join("\n      ");

      await add(`replies under ${subjects.threads.length} comments, in one document`, () =>
        ask(`query Replies($id: ID!) { moment(id: $id) { ${replies} } }`, { id: subjects.busiest }),
      );
    }

    // The positive control. Counting a discussion reads the whole comments
    // table, so this is the one read expected to grow with the corpus rather
    // than with the answer.
    await add("counting one discussion", () =>
      ask(`query Count($id: ID!) { moment(id: $id) { comments(first: 1) { total } } }`, {
        id: subjects.busiest,
      }),
    );

    if (subjects.mine.length >= 10) {
      const many = subjects.mine
        .slice(0, 10)
        .map((id, index) => `m${index}: moment(id: "${id}") { comments(first: 1) { total } }`)
        .join("\n    ");

      await add("counting ten discussions in one document", () => ask(`query Counts { ${many} }`));
    }
  }

  await add("forty years by year", () =>
    ask(
      `query Zoom($view: TimelineViewInput!, $scale: TimelineScale!) {
         temporalDistribution(view: $view, scale: $scale) {
           buckets { startsAt count representatives { momentId } } } }`,
      {
        view: {
          ...own,
          range: { fixed: { from: "1960-01-01T00:00:00Z", to: "1999-12-31T00:00:00Z" } },
        },
        scale: "YEAR",
      },
    ),
  );

  await add("one dense month by day", () =>
    ask(
      `query Zoom($view: TimelineViewInput!, $scale: TimelineScale!) {
         temporalDistribution(view: $view, scale: $scale) {
           buckets { startsAt count representatives { momentId } } } }`,
      {
        view: {
          ...own,
          range: { fixed: { from: "1994-06-01T00:00:00Z", to: "1994-06-30T00:00:00Z" } },
        },
        scale: "DAY",
      },
    ),
  );

  const AROUND = `query Jump($view: TimelineViewInput!, $anchor: TimelineAnchorInput!) {
    timelineAround(view: $view, anchor: $anchor, first: 50) {
      anchoredAt scope { type id }
      at { ... on ReadableTimelineEntry { momentId } }
      older { edges { node { ... on ReadableTimelineEntry { momentId } } } }
      newer { edges { node { ... on ReadableTimelineEntry { momentId } } } } } }`;

  await add("jumping to an instant", () =>
    ask(AROUND, { view: own, anchor: { instant: "1994-06-15T12:00:00Z" } }),
  );

  if (subjects.mine[0] !== undefined) {
    await add("jumping to a Moment", () =>
      ask(AROUND, { view: own, anchor: { moment: subjects.mine[0] } }),
    );
  }

  if (subjects.place !== undefined) {
    const AXIS = `query Axis($scope: TimelineScopeInput!, $at: DateTime!, $after: Cursor) {
      adjacentContexts(scope: $scope, at: $at, first: 50, after: $after) {
        edges { cursor node { name adjacency } } pageInfo { hasNextPage } } }`;
    const scope = { type: "LOCATION", id: subjects.place };
    const at = "1994-06-30T00:00:00Z";
    const first = await ask(AXIS, { scope, at });
    const last = first.body.data?.adjacentContexts?.edges?.at(-1)?.cursor;

    await add("the horizontal axis, first page", () => ask(AXIS, { scope, at }));

    if (last !== undefined) {
      // Tier two is the expensive one, and a first page that never leaves tier
      // one measures nothing about it.
      await add("the horizontal axis, paged onwards", () => ask(AXIS, { scope, at, after: last }));
    }
  }

  return measurements;
}

const measurements = await scenarios();
const held = await corpus();
const trip = await roundTrip();

await directory.pool.query("DELETE FROM sessions WHERE session_id = $1", [sessionId]);
await app.close();
await store.close();
await directory.close();

const report = {
  recordedAt: new Date().toISOString(),
  commit: execSync("git rev-parse --short HEAD").toString().trim(),
  machine: {
    platform: process.platform,
    arch: process.arch,
    cpus: cpus().length,
    memoryGb: Math.round(totalmem() / 1024 ** 3),
    node: process.version,
  },
  caveat:
    "Measured on one developer machine against local containers, through the service's own GraphQL surface with app.inject(). Comparable to another run on the same machine; not to anything else. Trust p50, and read every number against databaseRoundTripMs — on this machine much of it is the container network rather than this service.",
  projectionVersion: config.clickhouse.projectionVersion,
  graphql: { maxDepth: config.graphql.maxDepth },
  databaseRoundTripMs: trip,
  corpus: held,
  scenarios: measurements,
};

for (const scenario of measurements) {
  const flag = scenario.errors !== undefined ? " ERRORS" : scenario.returned ? "" : " EMPTY";

  process.stdout.write(
    `${String(scenario.p50).padStart(7)} ms  p95 ${String(scenario.p95).padStart(7)}  ` +
      `store ${String(scenario.storeMs).padStart(6)}  ` +
      `pg ${String(scenario.statements.postgres).padStart(3)}  ` +
      `ch ${String(scenario.statements.clickhouse).padStart(2)}  ${scenario.name}${flag}\n`,
  );
}

process.stdout.write(
  `\nround trip: postgres ${trip.postgres} ms, clickhouse ${trip.clickhouse} ms\n`,
);

if (values.compare !== undefined && existsSync(values.compare)) {
  const before = JSON.parse(readFileSync(values.compare, "utf8"));

  process.stdout.write(`\nagainst ${values.compare}:\n`);

  for (const scenario of measurements) {
    const was = before.scenarios.find((one) => one.name === scenario.name);

    if (was !== undefined) {
      const delta = Math.round((scenario.p50 - was.p50) * 10) / 10;

      // Printed, never judged. Whether a delta matters is a reading of the
      // corpus and the machine, not a threshold this script owns.
      process.stdout.write(
        `  ${was.p50} -> ${scenario.p50} ms (${delta >= 0 ? "+" : ""}${delta})  ${scenario.name}\n`,
      );
    }
  }
}

if (values.save) {
  const broken = measurements.filter((one) => one.errors !== undefined || !one.returned);

  if (broken.length > 0) {
    console.error(
      `\nRefusing to save: ${broken.length} scenario(s) errored or answered nothing.\n` +
        broken.map((one) => `  ${one.name}${one.errors ? `: ${one.errors[0]}` : ""}`).join("\n"),
    );
    process.exit(1);
  }

  writeFileSync(BASELINE, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`\nWrote ${BASELINE}\n`);
}
